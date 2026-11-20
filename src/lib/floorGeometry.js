import { buffer as turfBuffer } from '@turf/buffer';
import { union as turfUnion } from '@turf/union';

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
