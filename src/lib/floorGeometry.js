import { buffer as turfBuffer } from '@turf/buffer';
import { union as turfUnion } from '@turf/union';
import { assertWgs84 } from './shopGeometry.js';

export const DEFAULT_BUFFER_METERS = 5;
const DEFAULT_WALL_MARGIN_METERS = 0.5;
const BUFFER_STEPS = 8;
const DEFAULT_SIMPLIFY_TOLERANCE_METERS = 1;
const METERS_PER_DEGREE_LAT = 110540;
const METERS_PER_DEGREE_LON = 111320;

function collectPolygons(feature, out) {
  const geometry = feature?.geometry;
  if (!geometry) return;
  if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
    out.push({ type: 'Feature', geometry, properties: {} });
  } else if (geometry.type === 'GeometryCollection') {
    for (const part of geometry.geometries) {
      collectPolygons({ geometry: part }, out);
    }
  }
}

function outlineOnly(geometry) {
  if (geometry.type === 'Polygon') {
    return { type: 'Polygon', coordinates: geometry.coordinates.slice(0, 1) };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((polygon) => polygon.slice(0, 1)),
    };
  }
  return geometry;
}

function collectOutlinePolygons(node, out) {
  if (!node) return;
  if (node.type === 'FeatureCollection') {
    for (const feature of node.features ?? []) {
      collectOutlinePolygons(feature, out);
    }
    return;
  }
  if (node.type === 'Feature') {
    collectOutlinePolygons(node.geometry, out);
    return;
  }
  if (node.type === 'Polygon') {
    out.push(node.coordinates);
    return;
  }
  if (node.type === 'MultiPolygon') {
    out.push(...node.coordinates);
    return;
  }
  if (node.type === 'GeometryCollection') {
    for (const geometry of node.geometries ?? []) {
      collectOutlinePolygons(geometry, out);
    }
  }
}

function closeRing(ring) {
  if (!Array.isArray(ring) || ring.length < 3) {
    throw new Error('轮廓环至少需要 3 个坐标点');
  }
  const first = ring[0];
  const last = ring[ring.length - 1];
  if (first[0] === last[0] && first[1] === last[1]) return ring;
  return [...ring, first];
}

function projectToMeters(ring) {
  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const [lng, lat] of ring) {
    if (lng < minLng) minLng = lng;
    if (lat < minLat) minLat = lat;
    if (lng > maxLng) maxLng = lng;
    if (lat > maxLat) maxLat = lat;
  }
  const lat0 = (minLat + maxLat) / 2;
  const lon0 = (minLng + maxLng) / 2;
  const kx = METERS_PER_DEGREE_LON * Math.cos((lat0 * Math.PI) / 180);
  return ring.map(([lng, lat]) => [(lng - lon0) * kx, (lat - lat0) * METERS_PER_DEGREE_LAT]);
}

function douglasPeucker(points, toleranceMeters) {
  const last = points.length - 1;
  const keep = new Uint8Array(points.length);
  keep[0] = 1;
  keep[last] = 1;
  const tolerance2 = toleranceMeters * toleranceMeters;
  const stack = [[0, last]];

  while (stack.length) {
    const [start, end] = stack.pop();
    if (end <= start + 1) continue;
    const [sx, sy] = points[start];
    const [ex, ey] = points[end];
    const dx = ex - sx;
    const dy = ey - sy;
    const length2 = dx * dx + dy * dy;
    let maxDistance2 = -1;
    let maxIndex = -1;
    for (let i = start + 1; i < end; i += 1) {
      const [px, py] = points[i];
      let distance2;
      if (length2 === 0) {
        distance2 = (px - sx) * (px - sx) + (py - sy) * (py - sy);
      } else {
        const t = Math.max(0, Math.min(1, ((px - sx) * dx + (py - sy) * dy) / length2));
        const cx = sx + t * dx;
        const cy = sy + t * dy;
        distance2 = (px - cx) * (px - cx) + (py - cy) * (py - cy);
      }
      if (distance2 > maxDistance2) {
        maxDistance2 = distance2;
        maxIndex = i;
      }
    }
    if (maxDistance2 > tolerance2) {
      keep[maxIndex] = 1;
      stack.push([start, maxIndex], [maxIndex, end]);
    }
  }

  const kept = [];
  for (let i = 0; i < points.length; i += 1) {
    if (keep[i]) kept.push(i);
  }
  return kept;
}

function simplifyRing(ring, toleranceMeters) {
  if (ring.length <= 4) return ring;
  const kept = douglasPeucker(projectToMeters(ring), toleranceMeters);
  if (kept.length < 4) return ring;
  return kept.map((index) => ring[index]);
}

// jsts 外扩会把 CAD 转出的密集顶点放大到数百个，导航栅格化前先抽稀
function simplifyOutlineGeometry(geometry, toleranceMeters) {
  if (geometry.type === 'Polygon') {
    return {
      type: 'Polygon',
      coordinates: geometry.coordinates.map((ring) => simplifyRing(ring, toleranceMeters)),
    };
  }
  if (geometry.type === 'MultiPolygon') {
    return {
      type: 'MultiPolygon',
      coordinates: geometry.coordinates.map((polygon) =>
        polygon.map((ring) => simplifyRing(ring, toleranceMeters)),
      ),
    };
  }
  return geometry;
}

export function normalizeOutlineGeoJson(raw) {
  const polygons = [];
  collectOutlinePolygons(raw, polygons);
  if (!polygons.length) {
    throw new Error('没有可用的 Polygon / MultiPolygon 轮廓面');
  }

  const normalized = polygons.map((polygon) => polygon.map(closeRing));
  const geometry =
    normalized.length === 1
      ? { type: 'Polygon', coordinates: normalized[0] }
      : { type: 'MultiPolygon', coordinates: normalized };

  const geojson = {
    type: 'FeatureCollection',
    features: [{ type: 'Feature', properties: {}, geometry }],
  };
  assertWgs84(geojson.features);

  return { geojson, polygonCount: normalized.length };
}

export function deriveFloorFromShops(features, options = {}) {
  const bufferMeters = options.bufferMeters ?? DEFAULT_BUFFER_METERS;
  const wallMarginMeters =
    options.wallMarginMeters ?? DEFAULT_WALL_MARGIN_METERS;
  const simplifyToleranceMeters =
    options.simplifyToleranceMeters ?? DEFAULT_SIMPLIFY_TOLERANCE_METERS;
  const polygons = [];
  for (const feature of features ?? []) collectPolygons(feature, polygons);
  if (!polygons.length) return null;

  const merged =
    polygons.length === 1
      ? polygons[0]
      : turfUnion({ type: 'FeatureCollection', features: polygons });
  if (!merged) return null;

  // 闭运算：外扩黏连缝隙（≤2×bufferMeters），再等量内缩让外边界回到最外侧商铺外缘
  const dilated = turfBuffer(merged, bufferMeters, {
    units: 'meters',
    steps: BUFFER_STEPS,
  });
  if (!dilated) return null;

  const closed = turfBuffer(dilated, -bufferMeters, {
    units: 'meters',
    steps: BUFFER_STEPS,
  });
  if (!closed) return null;

  const withWall =
    wallMarginMeters > 0
      ? turfBuffer(closed, wallMarginMeters, {
          units: 'meters',
          steps: BUFFER_STEPS,
        })
      : closed;
  if (!withWall) return null;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: simplifyOutlineGeometry(
          outlineOnly(withWall.geometry),
          simplifyToleranceMeters,
        ),
      },
    ],
  };
}
