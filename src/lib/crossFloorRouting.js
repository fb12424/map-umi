import { buildNavGrid, findRoute, snapToMain } from "./routing.js";
import {
  FACILITY_KIND,
  facilityKindsOf,
  labelPoint,
  normalizeShopData,
} from "./shopGeometry.js";
import { floorLevel, matchFacility } from "./navSelection.js";
import { getMapGeoJson } from "../services/maps.js";

export const ELEVATOR_WAIT_SEC = 25;
export const ELEVATOR_PER_FLOOR_SEC = 8;
const PORTAL_MAX_METERS = 3;

// 同一份楼层数据只栅格化一次：建栅格要遍历整层楼板（实测约 0.8s），
// 远贵于 A*，而楼层的 shops/floor 在 scene 缓存里是稳定引用
const navGridCache = new WeakMap();

function navGridOf(scene) {
  const key = scene.shops?.features;
  if (!key) return buildNavGrid(key, scene.floor);
  let grid = navGridCache.get(key);
  if (!grid) {
    grid = buildNavGrid(key, scene.floor);
    navGridCache.set(key, grid);
  }
  return grid;
}

// 公共设施里带电梯项且有竖井编号的要素才是跨层连接件
export function elevatorShafts(features) {
  const result = [];
  for (const feature of features ?? []) {
    const props = feature.properties ?? {};
    if (!facilityKindsOf(props).includes(FACILITY_KIND.ELEVATOR)) continue;
    const shaftId = String(props.shaftId ?? "").trim();
    if (!shaftId) continue;
    result.push({ shaftId, feature });
  }
  return result;
}

// 换乘要覆盖所有楼层，但中间楼层只需要电梯清单：按楼层缓存 geojson 解析结果，
// 真正的场景与栅格等到路线经过时再加载
const shaftInventoryCache = new Map();

export function loadFloorShafts(floorId) {
  let pending = shaftInventoryCache.get(floorId);
  if (!pending) {
    pending = getMapGeoJson(floorId)
      .then((raw) => elevatorShafts(normalizeShopData(raw ?? { features: [] }).features))
      .catch((error) => {
        shaftInventoryCache.delete(floorId);
        throw error;
      });
    shaftInventoryCache.set(floorId, pending);
  }
  return pending;
}

function featureRings(feature) {
  const geometry = feature?.geometry ?? {};
  const polygons =
    geometry.type === "MultiPolygon"
      ? geometry.coordinates
      : geometry.type === "Polygon"
      ? [geometry.coordinates]
      : [];
  const rings = [];
  for (const polygon of polygons) for (const ring of polygon) rings.push(ring);
  return rings;
}

function pointSegDistance(px, py, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  let t = len2 === 0 ? 0 : ((px - a[0]) * dx + (py - a[1]) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (a[0] + t * dx), py - (a[1] + t * dy));
}

// snapToMain 会全局找最近主连通格，这里用"离要素轮廓足够近"排除
// 电梯被商铺/障碍围死、或只连到非主连通块的情况
function distanceToFeatureMeters(grid, xy, feature) {
  let min = Infinity;
  for (const ring of featureRings(feature)) {
    const pts = ring.map((c) => grid.project(c));
    for (let i = 0; i < pts.length; i += 1) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      min = Math.min(min, pointSegDistance(xy.x, xy.y, a, b));
    }
  }
  return min;
}

function portalPoint(grid, feature) {
  const snapped = snapToMain(grid, labelPoint(feature.geometry));
  if (!snapped) return null;
  if (distanceToFeatureMeters(grid, snapped, feature) > PORTAL_MAX_METERS) {
    return null;
  }
  const [lng, lat] = grid.inverse([snapped.x, snapped.y]);
  return { lngLat: [lng, lat] };
}

function levelGap(a, b) {
  const la = floorLevel(a);
  const lb = floorLevel(b);
  if (la === null || lb === null) return 1;
  return Math.max(1, Math.abs(la - lb));
}

export function nearestFacilityRoute(
  grid,
  startFeature,
  facilityKind,
  features,
  halfWidth = 0.4,
) {
  const start = labelPoint(startFeature.geometry);
  let best = null;
  for (const feature of features ?? []) {
    if (!matchFacility(feature.properties, facilityKind)) continue;
    try {
      const route = findRoute(grid, start, labelPoint(feature.geometry), {
        halfWidth,
      });
      if (!best || route.distance < best.route.distance) {
        best = { feature, route };
      }
    } catch {
      // 不可达的候选跳过
    }
  }
  return best;
}

// 设施终点：起点层内选最近可达设施，单层路线，无跨层步骤
export function computeFacilityRoute({
  scene,
  startFeature,
  facilityKind,
  halfWidth = 0.4,
}) {
  const grid = navGridOf(scene);
  const best = nearestFacilityRoute(
    grid,
    startFeature,
    facilityKind,
    scene.shops.features,
    halfWidth,
  );
  if (!best) throw new Error("该设施暂不可达");

  return {
    sameFloor: true,
    startFloorId: scene.floorId,
    endFloorId: scene.floorId,
    startFloorCode: scene.floorCode,
    endFloorCode: scene.floorCode,
    startPoint: best.route.startPoint,
    endPoint: best.route.endPoint,
    segments: [
      {
        kind: "walk",
        floorId: scene.floorId,
        coordinates: best.route.coordinates,
      },
    ],
    steps: [],
    distance: best.route.distance,
    duration: best.route.duration,
    rides: [],
    facilityFeature: best.feature,
  };
}

function shaftNameOf(feature, shaftId) {
  return (feature?.properties?.name || "").trim() || shaftId;
}

const NODE_SEP = "\u0000";

function nodeKey(floorKey, shaftId) {
  return `${floorKey}${NODE_SEP}${shaftId}`;
}

function parseNodeKey(key) {
  const at = key.indexOf(NODE_SEP);
  return { floorKey: key.slice(0, at), shaftId: key.slice(at + 1) };
}

function buildShaftGraph(inventory) {
  const floors = new Map();
  const byShaft = new Map();
  for (const entry of inventory ?? []) {
    const floorKey = String(entry.floorId);
    const shafts = new Map();
    for (const shaft of entry.shafts ?? []) {
      shafts.set(shaft.shaftId, shaft.feature);
      const list = byShaft.get(shaft.shaftId) ?? [];
      list.push({
        floorId: entry.floorId,
        floorCode: entry.floorCode,
        feature: shaft.feature,
      });
      byShaft.set(shaft.shaftId, list);
    }
    floors.set(floorKey, {
      floorId: entry.floorId,
      floorCode: entry.floorCode,
      shafts,
    });
  }
  return { floors, byShaft };
}

// 换乘规划：节点是"楼层×竖井"，边是乘梯（同竖井跨层）和同层步行，
// 用 Dijkstra 按总时间找最优组合；经过的楼层才加载场景、建栅格
async function planTransferRoute({
  startScene,
  endScene,
  startFeature,
  endFeature,
  inventory,
  loadScene,
  halfWidth,
}) {
  const { floors, byShaft } = buildShaftGraph(inventory);
  const startKey = String(startScene.floorId);
  const endKey = String(endScene.floorId);
  if (!floors.has(startKey) || !floors.has(endKey)) {
    throw new Error("楼层数据不完整，无法规划换乘路线");
  }

  const sceneCache = new Map([
    [startKey, startScene],
    [endKey, endScene],
  ]);
  const gridCache = new Map();
  const portalCache = new Map();
  const transferWalkCache = new Map();

  const sceneOf = async (floorKey) => {
    if (!sceneCache.has(floorKey)) {
      const entry = floors.get(floorKey);
      sceneCache.set(floorKey, await loadScene(entry.floorId));
    }
    return sceneCache.get(floorKey);
  };
  const gridOf = async (floorKey) => {
    if (!gridCache.has(floorKey)) {
      gridCache.set(floorKey, navGridOf(await sceneOf(floorKey)));
    }
    return gridCache.get(floorKey);
  };
  const portalOf = async (floorKey, shaftId) => {
    const key = nodeKey(floorKey, shaftId);
    if (!portalCache.has(key)) {
      const feature = floors.get(floorKey)?.shafts.get(shaftId);
      const portal = feature ? portalPoint(await gridOf(floorKey), feature) : null;
      portalCache.set(key, portal);
    }
    return portalCache.get(key);
  };
  const walkOf = async (floorKey, fromLngLat, toLngLat) => {
    const grid = await gridOf(floorKey);
    try {
      return findRoute(grid, fromLngLat, toLngLat, { halfWidth });
    } catch {
      return null;
    }
  };
  const transferWalkOf = async (floorKey, fromShaftId, toShaftId) => {
    const key = `${floorKey}${NODE_SEP}${fromShaftId}->${toShaftId}`;
    if (!transferWalkCache.has(key)) {
      const from = await portalOf(floorKey, fromShaftId);
      const to = await portalOf(floorKey, toShaftId);
      transferWalkCache.set(
        key,
        from && to ? await walkOf(floorKey, from.lngLat, to.lngLat) : null,
      );
    }
    return transferWalkCache.get(key);
  };

  const START = "__start__";
  const dist = new Map([[START, 0]]);
  const prev = new Map();
  const settled = new Set();
  const queue = [START];
  let best = null;

  const relax = (key, cost, prevKey, edge) => {
    if (settled.has(key)) return;
    const known = dist.get(key);
    if (known !== undefined && known <= cost) return;
    dist.set(key, cost);
    prev.set(key, { prevKey, edge });
    if (!queue.includes(key)) queue.push(key);
  };

  const popMin = () => {
    let bestIndex = -1;
    let bestCost = Infinity;
    for (let i = 0; i < queue.length; i += 1) {
      const cost = dist.get(queue[i]);
      if (cost !== undefined && cost < bestCost) {
        bestCost = cost;
        bestIndex = i;
      }
    }
    return bestIndex < 0 ? null : queue.splice(bestIndex, 1)[0];
  };

  while (queue.length) {
    const key = popMin();
    if (key === null) break;
    const cost = dist.get(key);
    if (best && cost >= best.cost) break;
    if (settled.has(key)) continue;
    settled.add(key);

    if (key === START) {
      const startPoint = labelPoint(startFeature.geometry);
      for (const [shaftId] of floors.get(startKey).shafts) {
        const portal = await portalOf(startKey, shaftId);
        if (!portal) continue;
        const route = await walkOf(startKey, startPoint, portal.lngLat);
        if (!route) continue;
        relax(nodeKey(startKey, shaftId), cost + route.duration, START, {
          kind: "walk",
          floorKey: startKey,
          route,
          toShaftId: shaftId,
        });
      }
      continue;
    }

    const { floorKey, shaftId } = parseNodeKey(key);
    const floor = floors.get(floorKey);
    const floorCode = floor.floorCode;

    if (floorKey === endKey) {
      const portal = await portalOf(floorKey, shaftId);
      if (portal) {
        const route = await walkOf(
          floorKey,
          portal.lngLat,
          labelPoint(endFeature.geometry),
        );
        if (route) {
          const total = cost + route.duration;
          if (!best || total < best.cost) {
            best = {
              cost: total,
              endKey: key,
              endEdge: { kind: "walk", floorKey, route },
            };
          }
        }
      }
    }

    const currentPortal = await portalOf(floorKey, shaftId);
    if (!currentPortal) continue;

    for (const other of byShaft.get(shaftId) ?? []) {
      const otherKey = String(other.floorId);
      if (otherKey === floorKey) continue;
      const rideSec =
        ELEVATOR_PER_FLOOR_SEC * levelGap(floorCode, other.floorCode);
      relax(
        nodeKey(otherKey, shaftId),
        cost + ELEVATOR_WAIT_SEC + rideSec,
        key,
        {
          kind: "connector",
          shaftId,
          // 乘梯文案取上梯楼层该电梯的名称，和乘客看到的标识一致
          shaftName: shaftNameOf(floor.shafts.get(shaftId), shaftId),
          fromFloorKey: floorKey,
          toFloorKey: otherKey,
          waitSec: ELEVATOR_WAIT_SEC,
          rideSec,
        },
      );
    }

    for (const [otherShaftId, otherFeature] of floor.shafts) {
      if (otherShaftId === shaftId) continue;
      const route = await transferWalkOf(floorKey, shaftId, otherShaftId);
      if (!route) continue;
      relax(nodeKey(floorKey, otherShaftId), cost + route.duration, key, {
        kind: "walk",
        floorKey,
        route,
        fromShaftId: shaftId,
        toShaftId: otherShaftId,
        fromShaftName: shaftNameOf(floor.shafts.get(shaftId), shaftId),
        toShaftName: shaftNameOf(otherFeature, otherShaftId),
      });
    }
  }

  if (!best) throw new Error("当前电梯网络无法换乘到达目标楼层");

  const edges = [];
  let cursor = best.endKey;
  while (cursor !== START) {
    const step = prev.get(cursor);
    if (!step) throw new Error("换乘路线生成失败");
    edges.push(step.edge);
    cursor = step.prevKey;
  }
  edges.reverse();
  edges.push(best.endEdge);

  const segments = [];
  const rides = [];
  let distance = 0;
  let duration = 0;
  let startPoint = null;
  let endPoint = null;

  for (const edge of edges) {
    if (edge.kind === "walk") {
      segments.push({
        kind: "walk",
        floorId: floors.get(edge.floorKey).floorId,
        coordinates: edge.route.coordinates,
      });
      distance += edge.route.distance;
      duration += edge.route.duration;
      if (!startPoint) startPoint = edge.route.startPoint;
      endPoint = edge.route.endPoint;
      continue;
    }

    const fromPortal = await portalOf(edge.fromFloorKey, edge.shaftId);
    const toPortal = await portalOf(edge.toFloorKey, edge.shaftId);
    if (!fromPortal || !toPortal) throw new Error("换乘路线生成失败");

    segments.push({
      kind: "connector",
      shaftId: edge.shaftId,
      shaftName: edge.shaftName,
      fromFloorId: floors.get(edge.fromFloorKey).floorId,
      toFloorId: floors.get(edge.toFloorKey).floorId,
      from: fromPortal.lngLat,
      to: toPortal.lngLat,
      waitSec: edge.waitSec,
      rideSec: edge.rideSec,
    });
    rides.push({
      shaftId: edge.shaftId,
      shaftName: edge.shaftName,
      fromFloorId: floors.get(edge.fromFloorKey).floorId,
      toFloorId: floors.get(edge.toFloorKey).floorId,
      waitSec: edge.waitSec,
      rideSec: edge.rideSec,
    });
    duration += edge.waitSec + edge.rideSec;
  }

  const steps = [
    {
      floorId: startScene.floorId,
      floorCode: startScene.floorCode,
      role: "start",
    },
  ];
  let rideLabel = "";
  for (const edge of edges) {
    if (edge.kind === "connector") {
      rideLabel = `乘 ${edge.shaftName}`;
      continue;
    }
    if (!edge.toShaftId || edge.floorKey === startKey || edge.floorKey === endKey) {
      continue;
    }
    const entry = floors.get(edge.floorKey);
    steps.push({
      floorId: entry.floorId,
      floorCode: entry.floorCode,
      role: "transfer",
      connectorLabel: rideLabel,
      label: `${edge.fromShaftName} → ${edge.toShaftName}`,
    });
    rideLabel = "";
  }
  steps.push({
    floorId: endScene.floorId,
    floorCode: endScene.floorCode,
    role: "end",
    connectorLabel: rideLabel,
  });

  return {
    sameFloor: false,
    startFloorId: startScene.floorId,
    endFloorId: endScene.floorId,
    startFloorCode: startScene.floorCode,
    endFloorCode: endScene.floorCode,
    startPoint,
    endPoint,
    segments,
    steps,
    distance,
    duration,
    rides,
  };
}

// 商铺终点：同层直接找路；跨层在"楼层×竖井"电梯网络上找时间最短的组合
export async function computeNavigationRoute({
  startScene,
  endScene,
  startFeature,
  endFeature,
  inventory,
  loadScene,
  halfWidth = 0.4,
}) {
  const startFloorId = startScene.floorId;
  const endFloorId = endScene.floorId;
  const startFloorCode = startScene.floorCode;
  const endFloorCode = endScene.floorCode;

  if (startFloorId === endFloorId) {
    const route = findRoute(
      navGridOf(startScene),
      labelPoint(startFeature.geometry),
      labelPoint(endFeature.geometry),
      { halfWidth },
    );
    return {
      sameFloor: true,
      startFloorId,
      endFloorId,
      startFloorCode,
      endFloorCode,
      startPoint: route.startPoint,
      endPoint: route.endPoint,
      segments: [
        { kind: "walk", floorId: startFloorId, coordinates: route.coordinates },
      ],
      steps: [],
      distance: route.distance,
      duration: route.duration,
      rides: [],
    };
  }

  return planTransferRoute({
    startScene,
    endScene,
    startFeature,
    endFeature,
    inventory,
    loadScene,
    halfWidth,
  });
}
