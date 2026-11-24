// 区域类型：商铺沿用位号/商户体系，其余为非商铺设施（只显示名称）；
// 障碍区（墙体/柱子/镂空中庭）是纯几何占位，不显示标签也不参与导航
export const AREA_TYPE = {
  SHOP: 'shop',
  ELEVATOR: 'elevator',
  TOILET: 'toilet',
  NURSING: 'nursing',
  OBSTACLE: 'obstacle',
};

export const AREA_TYPE_LABEL = {
  [AREA_TYPE.SHOP]: '商铺',
  [AREA_TYPE.ELEVATOR]: '电梯',
  [AREA_TYPE.TOILET]: '厕所',
  [AREA_TYPE.NURSING]: '母婴室',
  [AREA_TYPE.OBSTACLE]: '障碍区',
};

const NON_SHOP_TYPES = new Set(
  Object.values(AREA_TYPE).filter((type) => type !== AREA_TYPE.SHOP),
);

// 历史数据没有 type 字段，一律按商铺处理，避免老地图被当成设施
export function areaTypeOf(properties) {
  const type = properties?.type;
  return NON_SHOP_TYPES.has(type) ? type : AREA_TYPE.SHOP;
}

export function isShopFeature(properties) {
  return areaTypeOf(properties) === AREA_TYPE.SHOP;
}

export function isObstacleFeature(properties) {
  return areaTypeOf(properties) === AREA_TYPE.OBSTACLE;
}

const FACILITY_TYPES = new Set([
  AREA_TYPE.ELEVATOR,
  AREA_TYPE.TOILET,
  AREA_TYPE.NURSING,
]);

// 设施 = 非商铺且非障碍物（电梯/厕所/母婴室），标注上会带类型图标
export function isFacilityType(type) {
  return FACILITY_TYPES.has(type);
}

// label 派生规则：商铺=铺位号，设施=名称；障碍区没有标签
export function areaLabelOf(properties) {
  const type = areaTypeOf(properties);
  if (type === AREA_TYPE.OBSTACLE) return '';
  if (type === AREA_TYPE.SHOP) {
    return (properties?.code || '').trim() || '未编号';
  }
  return (properties?.name || '').trim() || '未命名';
}

// 地图上直接展示的短文案：商铺=位号，设施=名称，障碍区不展示
export function areaTextOf(properties) {
  const type = areaTypeOf(properties);
  if (type === AREA_TYPE.OBSTACLE) return '';
  return type === AREA_TYPE.SHOP
    ? (properties?.code || '').trim()
    : (properties?.name || '').trim();
}

function ringMetrics(ring) {
  const originX = ring[0][0];
  const originY = ring[0][1];
  let twiceArea = 0;
  let x = 0;
  let y = 0;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const x0 = ring[j][0] - originX;
    const y0 = ring[j][1] - originY;
    const x1 = ring[i][0] - originX;
    const y1 = ring[i][1] - originY;
    const cross = x0 * y1 - x1 * y0;
    twiceArea += cross;
    x += (x0 + x1) * cross;
    y += (y0 + y1) * cross;
  }

  if (twiceArea === 0) {
    return { area: 0, centroid: [originX, originY] };
  }

  return {
    area: Math.abs(twiceArea / 2),
    centroid: [
      originX + x / (3 * twiceArea),
      originY + y / (3 * twiceArea),
    ],
  };
}

function pointInRing(point, ring) {
  const [x, y] = point;
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) {
      inside = !inside;
    }
  }
  return inside;
}

export function pointInPolygon(point, polygon) {
  if (!pointInRing(point, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(point, polygon[i])) return false;
  }
  return true;
}

export function labelPoint(geometry) {
  const polygons =
    geometry.type === 'MultiPolygon' ? geometry.coordinates : [geometry.coordinates];
  let bestPolygon = polygons[0];
  let bestArea = -1;
  let centroid = ringMetrics(bestPolygon[0]).centroid;

  for (const polygon of polygons) {
    const metrics = ringMetrics(polygon[0]);
    if (metrics.area > bestArea) {
      bestArea = metrics.area;
      bestPolygon = polygon;
      centroid = metrics.centroid;
    }
  }

  if (pointInPolygon(centroid, bestPolygon)) return centroid;

  const ring = bestPolygon[0];
  const xs = ring.map((point) => point[0]);
  const ys = ring.map((point) => point[1]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  const fractions = [0.5, 0.4, 0.6, 0.3, 0.7, 0.2, 0.8];

  let fallback = centroid;
  let bestDistance = Infinity;

  for (const fy of fractions) {
    for (const fx of fractions) {
      const candidate = [minX + (maxX - minX) * fx, minY + (maxY - minY) * fy];
      if (!pointInPolygon(candidate, bestPolygon)) continue;
      const distance =
        (candidate[0] - centroid[0]) ** 2 + (candidate[1] - centroid[1]) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        fallback = candidate;
      }
    }
  }

  return fallback;
}

export function labelWidth(text) {
  let width = 0;
  for (const char of text) {
    width += char.charCodeAt(0) > 0xff ? 10 : 6.4;
  }
  return width + 12;
}

export function findDuplicateCodes(features) {
  const counts = new Map();
  for (const feature of features) {
    const code = (feature.properties?.code || '').trim();
    if (code) counts.set(code, (counts.get(code) || 0) + 1);
  }

  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([code]) => code);
}

export function normalizeShopData(geojson) {
  const features = [];

  let nextUid = 0;
  for (const feature of geojson.features) {
    const match = /^shop-(\d+)$/.exec(feature.properties?.uid ?? '');
    if (match) nextUid = Math.max(nextUid, Number(match[1]) + 1);
  }
  const usedUids = new Set();

  geojson.features.forEach((feature) => {
    const geometry = feature.geometry;
    let polygons = [];

    if (geometry?.type === 'Polygon') {
      polygons = [geometry.coordinates];
    } else if (geometry?.type === 'MultiPolygon') {
      polygons = geometry.coordinates;
    } else if (geometry?.type === 'GeometryCollection') {
      for (const part of geometry.geometries) {
        if (part?.type === 'Polygon') polygons.push(part.coordinates);
        else if (part?.type === 'MultiPolygon') polygons.push(...part.coordinates);
      }
    }

    if (!polygons.length) return;

    let uid =
      typeof feature.properties?.uid === 'string'
        ? feature.properties.uid.trim()
        : '';
    if (!uid || usedUids.has(uid)) uid = `shop-${nextUid++}`;
    usedUids.add(uid);
    feature.properties = { ...feature.properties, uid };

    const type = areaTypeOf(feature.properties);
    const code = (feature.properties?.code || '').trim();
    const area = Number(feature.properties?.area_m2);

    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polygons },
      properties: {
        ...feature.properties,
        type,
        code,
        label: areaLabelOf({ ...feature.properties, type, code }),
        area_m2: Number.isFinite(area) ? area : 0,
        uid,
      },
    });
  });

  return { type: 'FeatureCollection', features };
}

function firstPosition(coordinates) {
  let cursor = coordinates;
  while (Array.isArray(cursor) && Array.isArray(cursor[0])) cursor = cursor[0];
  return cursor;
}

export function assertWgs84(features) {
  for (const feature of features) {
    const [lng, lat] = firstPosition(feature.geometry.coordinates) ?? [];
    if (
      !Number.isFinite(lng) ||
      !Number.isFinite(lat) ||
      Math.abs(lng) > 180 ||
      Math.abs(lat) > 90
    ) {
      throw new Error('坐标不在 WGS84 经纬度范围内（经度 -180~180，纬度 -90~90）');
    }
  }
}
