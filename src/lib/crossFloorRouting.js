import { buildNavGrid, findRoute, snapToMain } from "./routing.js";
import {
  FACILITY_KIND,
  facilityKindsOf,
  labelPoint,
} from "./shopGeometry.js";
import { floorLevel, matchFacility } from "./navSelection.js";

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
    shaftId: null,
    shaftName: null,
    facilityFeature: best.feature,
  };
}

// 商铺终点：同层直接找路；跨层按竖井筛选 + 总代价比较（P0 单次乘梯）
export function computeNavigationRoute({
  startScene,
  endScene,
  startFeature,
  endFeature,
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
      shaftId: null,
      shaftName: null,
    };
  }

  const gridA = navGridOf(startScene);
  const gridB = navGridOf(endScene);
  const byIdB = new Map(
    elevatorShafts(endScene.shops.features).map((s) => [s.shaftId, s.feature]),
  );

  let best = null;
  for (const a of elevatorShafts(startScene.shops.features)) {
    const bFeature = byIdB.get(a.shaftId);
    if (!bFeature) continue;
    const portalA = portalPoint(gridA, a.feature);
    const portalB = portalPoint(gridB, bFeature);
    if (!portalA || !portalB) continue;
    try {
      const legA = findRoute(
        gridA,
        labelPoint(startFeature.geometry),
        portalA.lngLat,
        { halfWidth },
      );
      const legB = findRoute(
        gridB,
        portalB.lngLat,
        labelPoint(endFeature.geometry),
        { halfWidth },
      );
      const rideSec =
        ELEVATOR_WAIT_SEC +
        ELEVATOR_PER_FLOOR_SEC * levelGap(startFloorCode, endFloorCode);
      const cost = legA.duration + rideSec + legB.duration;
      if (!best || cost < best.cost) {
        best = {
          shaftId: a.shaftId,
          shaftName: (a.feature.properties?.name || "").trim() || a.shaftId,
          legA,
          legB,
          portalA,
          portalB,
          rideSec,
          cost,
        };
      }
    } catch {
      // 该电梯组合不可达，跳过
    }
  }

  if (!best) throw new Error("两楼层之间没有可用的电梯，暂无法跨层导航");

  return {
    sameFloor: false,
    startFloorId,
    endFloorId,
    startFloorCode,
    endFloorCode,
    startPoint: best.legA.startPoint,
    endPoint: best.legB.endPoint,
    segments: [
      {
        kind: "walk",
        floorId: startFloorId,
        coordinates: best.legA.coordinates,
      },
      {
        kind: "connector",
        shaftId: best.shaftId,
        shaftName: best.shaftName,
        fromFloorId: startFloorId,
        toFloorId: endFloorId,
        from: best.portalA.lngLat,
        to: best.portalB.lngLat,
        waitSec: ELEVATOR_WAIT_SEC,
        rideSec: best.rideSec,
      },
      {
        kind: "walk",
        floorId: endFloorId,
        coordinates: best.legB.coordinates,
      },
    ],
    steps: [
      { floorId: startFloorId, floorCode: startFloorCode, role: "start" },
      { floorId: endFloorId, floorCode: endFloorCode, role: "end" },
    ],
    distance: best.legA.distance + best.legB.distance,
    duration: best.legA.duration + best.rideSec + best.legB.duration,
    shaftId: best.shaftId,
    shaftName: best.shaftName,
  };
}
