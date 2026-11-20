import { buffer as turfBuffer } from '@turf/buffer';
import { union as turfUnion } from '@turf/union';
import { assertWgs84 } from './shopGeometry.js';

export const DEFAULT_BUFFER_METERS = 4;
const BUFFER_STEPS = 8;

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
  const polygons = [];
  for (const feature of features ?? []) collectPolygons(feature, polygons);
  if (!polygons.length) return null;

  const merged =
    polygons.length === 1
      ? polygons[0]
      : turfUnion({ type: 'FeatureCollection', features: polygons });
  if (!merged) return null;

  const buffered = turfBuffer(merged, bufferMeters, {
    units: 'meters',
    steps: BUFFER_STEPS,
  });
  if (!buffered) return null;

  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {},
        geometry: outlineOnly(buffered.geometry),
      },
    ],
  };
}
