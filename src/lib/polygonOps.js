import { difference, intersection, union } from 'polyclip-ts';
import { pointInPolygon } from './shopGeometry.js';

const EARTH_RADIUS = 6378137;
const RAD = Math.PI / 180;

export const MIN_SLIVER_M2 = 0.2;
const MIN_AREA_CHANGE_M2 = 0.01;
const METERS_PER_DEG_LAT = 111320;
const ON_BOUNDARY_TOLERANCE_M = 0.1;

function ringAreaM2(ring) {
  if (!ring || ring.length < 3) return 0;

  let total = 0;
  for (let i = 0; i < ring.length; i += 1) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[(i + 1) % ring.length];
    total +=
      (lng2 - lng1) *
      RAD *
      (2 + Math.sin(lat1 * RAD) + Math.sin(lat2 * RAD));
  }

  return Math.abs((total * EARTH_RADIUS * EARTH_RADIUS) / 2);
}

export function polygonAreaM2(polygon) {
  if (!polygon?.length) return 0;
  let area = ringAreaM2(polygon[0]);
  for (let i = 1; i < polygon.length; i += 1) {
    area -= ringAreaM2(polygon[i]);
  }
  return Math.max(area, 0);
}

export function polygonsAreaM2(polygons) {
  let area = 0;
  for (const polygon of asPolygons(polygons)) area += polygonAreaM2(polygon);
  return area;
}

export function geometryToPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  return [];
}

export function polygonsToGeometry(polygons) {
  return { type: 'MultiPolygon', coordinates: polygons };
}

function asPolygons(input) {
  if (!Array.isArray(input) || !input.length) return [];
  // Polygon: [[x, y], ...] 的下一层就是坐标；Poly[] 的下一层是环
  return typeof input[0]?.[0]?.[0] === 'number' ? [input] : input;
}

function toGeom(polygons) {
  return polygons.length === 1 ? polygons[0] : polygons;
}

export function cleanPolygons(polygons, minArea = MIN_SLIVER_M2) {
  const cleaned = [];

  for (const polygon of asPolygons(polygons)) {
    if (!polygon?.length) continue;
    if (ringAreaM2(polygon[0]) < minArea) continue;

    const holes = polygon
      .slice(1)
      .filter((ring) => ringAreaM2(ring) >= minArea);
    cleaned.push([polygon[0], ...holes]);
  }

  return cleaned;
}

export function unionPolygons(polygons) {
  const list = asPolygons(polygons).filter((polygon) => polygon?.length);
  if (!list.length) return [];
  if (list.length === 1) return list;

  return union(list[0], ...list.slice(1));
}

export function subtractPolygons(polygons, clipPolygons) {
  const subject = asPolygons(polygons).filter((polygon) => polygon?.length);
  const clip = asPolygons(clipPolygons).filter((polygon) => polygon?.length);

  if (!subject.length) return [];
  if (!clip.length) return subject;

  return difference(toGeom(subject), toGeom(clip));
}

export function intersectPolygons(polygons, clipPolygons) {
  const subject = asPolygons(polygons).filter((polygon) => polygon?.length);
  const clip = asPolygons(clipPolygons).filter((polygon) => polygon?.length);

  if (!subject.length || !clip.length) return [];

  return intersection(toGeom(subject), toGeom(clip));
}

export function pointInPolygons(point, polygons) {
  return asPolygons(polygons).some((polygon) => pointInPolygon(point, polygon));
}

export function pointOnBoundary(point, polygons, toleranceM = ON_BOUNDARY_TOLERANCE_M) {
  const [px, py] = point;
  const scaleX = METERS_PER_DEG_LAT * Math.cos((py * Math.PI) / 180);

  for (const polygon of asPolygons(polygons)) {
    for (const ring of polygon) {
      if (!ring) continue;
      for (let i = 0; i < ring.length; i += 1) {
        const [ax, ay] = ring[i];
        const [bx, by] = ring[(i + 1) % ring.length];
        const abx = (bx - ax) * scaleX;
        const aby = (by - ay) * METERS_PER_DEG_LAT;
        const apx = (px - ax) * scaleX;
        const apy = (py - ay) * METERS_PER_DEG_LAT;
        const lengthSq = abx * abx + aby * aby;
        if (!lengthSq) continue;

        const t = Math.max(0, Math.min(1, (apx * abx + apy * aby) / lengthSq));
        if (Math.hypot(apx - abx * t, apy - aby * t) <= toleranceM) return true;
      }
    }
  }
  return false;
}

export function splitPolygonsByLine(polygons, start, end) {
  const dx = end[0] - start[0];
  const dy = end[1] - start[1];
  const length = Math.hypot(dx, dy);
  if (!length) return null;

  const list = asPolygons(polygons).filter((polygon) => polygon?.length);
  if (!list.length) return null;

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const polygon of list) {
    for (const ring of polygon) {
      for (const [x, y] of ring) {
        if (x < minX) minX = x;
        if (y < minY) minY = y;
        if (x > maxX) maxX = x;
        if (y > maxY) maxY = y;
      }
    }
  }

  const margin = Math.max(maxX - minX, maxY - minY, 1e-9) * 2;
  const ux = dx / length;
  const uy = dy / length;
  const nx = -uy;
  const ny = ux;

  const ax = start[0] - ux * margin;
  const ay = start[1] - uy * margin;
  const bx = end[0] + ux * margin;
  const by = end[1] + uy * margin;

  const halfA = [
    [ax, ay],
    [bx, by],
    [bx + nx * margin, by + ny * margin],
    [ax + nx * margin, ay + ny * margin],
    [ax, ay],
  ];
  const halfB = [
    [ax, ay],
    [bx, by],
    [bx - nx * margin, by - ny * margin],
    [ax - nx * margin, ay - ny * margin],
    [ax, ay],
  ];

  const pieceA = cleanPolygons(intersectPolygons(list, [halfA]));
  const pieceB = cleanPolygons(intersectPolygons(list, [halfB]));
  if (!pieceA.length || !pieceB.length) return null;
  return [pieceA, pieceB];
}

export function areaChanged(beforeM2, afterM2) {
  return Math.abs(beforeM2 - afterM2) >= MIN_AREA_CHANGE_M2;
}

export function nextShopUid(features) {
  let next = 0;
  for (const feature of features ?? []) {
    const match = /^shop-(\d+)$/.exec(feature.properties?.uid ?? '');
    if (match) next = Math.max(next, Number(match[1]) + 1);
  }
  return `shop-${next}`;
}

export function createShopFeature(polygons, properties = {}) {
  const code = (properties.code || '').trim();

  return {
    type: 'Feature',
    geometry: polygonsToGeometry(polygons),
    properties: {
      ...properties,
      code,
      label: code || '未编号',
      area_m2: polygonsAreaM2(polygons),
    },
  };
}

export function updateShopGeometry(feature, polygons) {
  return {
    ...feature,
    geometry: polygonsToGeometry(polygons),
    properties: {
      ...feature.properties,
      area_m2: polygonsAreaM2(polygons),
    },
  };
}

export function buildEditedDataset(dataset, shops) {
  const shopByUid = new Map(
    shops.features.map((feature) => [feature.properties.uid, feature]),
  );
  const initialByUid = new Map(
    (dataset.shops?.features ?? []).map((feature) => [
      feature.properties.uid,
      feature,
    ]),
  );

  const emitted = new Set();
  const features = [];

  for (const rawFeature of dataset.raw?.features ?? []) {
    const uid = rawFeature.properties?.uid;
    const shop = uid ? shopByUid.get(uid) : null;

    if (!shop) {
      if (uid && initialByUid.has(uid)) continue;
      features.push(rawFeature);
      continue;
    }

    emitted.add(uid);
    const untouched = initialByUid.get(uid) === shop;

    features.push({
      ...rawFeature,
      geometry: untouched ? rawFeature.geometry : shop.geometry,
      properties: { ...rawFeature.properties, ...shop.properties },
    });
  }

  for (const shop of shops.features) {
    const uid = shop.properties.uid;
    if (emitted.has(uid)) continue;

    features.push({
      type: 'Feature',
      geometry: shop.geometry,
      properties: { ...shop.properties },
    });
  }

  return {
    ...dataset,
    shops,
    raw: {
      ...(dataset.raw ?? { type: 'FeatureCollection' }),
      type: 'FeatureCollection',
      features,
    },
    unitCount: shops.features.length,
  };
}