// 区域类型：商铺沿用位号/商户体系；公共设施用设施项集合（电梯/厕所/母婴室）描述；
// 障碍区（墙体/柱子/镂空中庭）是纯几何占位，不显示标签也不参与导航
export const AREA_TYPE = {
  SHOP: 'shop',
  FACILITY: 'facility',
  OBSTACLE: 'obstacle',
};

export const AREA_TYPE_LABEL = {
  [AREA_TYPE.SHOP]: '商铺',
  [AREA_TYPE.FACILITY]: '公共设施',
  [AREA_TYPE.OBSTACLE]: '障碍区',
};

// 公共设施下的具体设施项，数组顺序即表单和图标展示顺序
export const FACILITY_KIND = {
  ELEVATOR: 'elevator',
  TOILET: 'toilet',
  NURSING: 'nursing',
};

export const FACILITY_KIND_LABEL = {
  [FACILITY_KIND.ELEVATOR]: '电梯',
  [FACILITY_KIND.TOILET]: '厕所',
  [FACILITY_KIND.NURSING]: '母婴室',
};

export const FACILITY_KINDS = Object.values(FACILITY_KIND);

// 旧数据把设施直接存在 type 上（elevator/toilet/nursing），读取时统一
// 映射成"公共设施 + 对应设施项"，保存后写回新结构
const LEGACY_FACILITY_TYPES = {
  [FACILITY_KIND.ELEVATOR]: FACILITY_KIND.ELEVATOR,
  [FACILITY_KIND.TOILET]: FACILITY_KIND.TOILET,
  [FACILITY_KIND.NURSING]: FACILITY_KIND.NURSING,
};

// 历史数据没有 type 字段，一律按商铺处理，避免老地图被当成设施
export function areaTypeOf(properties) {
  const type = properties?.type;
  if (type === AREA_TYPE.OBSTACLE) return AREA_TYPE.OBSTACLE;
  if (type === AREA_TYPE.FACILITY || LEGACY_FACILITY_TYPES[type]) {
    return AREA_TYPE.FACILITY;
  }
  return AREA_TYPE.SHOP;
}

export function isShopFeature(properties) {
  return areaTypeOf(properties) === AREA_TYPE.SHOP;
}

export function isObstacleFeature(properties) {
  return areaTypeOf(properties) === AREA_TYPE.OBSTACLE;
}

// 设施 = 公共设施（电梯/厕所/母婴室），标注上会带一个或多个类型图标
export function isFacilityType(type) {
  return type === AREA_TYPE.FACILITY || Boolean(LEGACY_FACILITY_TYPES[type]);
}

// 过滤未知值、去重并按固定顺序排列，表单回填和预览共用
export function normalizeFacilityKinds(value) {
  if (!Array.isArray(value)) return [];
  const selected = new Set(value);
  return FACILITY_KINDS.filter((kind) => selected.has(kind));
}

// MapLibre 的 queryRenderedFeatures 会把数组/对象属性序列化成 JSON 字符串，
// 这里两种形态都要认，否则从地图点击回填时设施项会丢
function readFacilityKinds(value) {
  if (Array.isArray(value)) return normalizeFacilityKinds(value);
  if (typeof value === 'string') {
    try {
      return normalizeFacilityKinds(JSON.parse(value));
    } catch {
      return [];
    }
  }
  return [];
}

export function facilityKindsOf(properties) {
  if (areaTypeOf(properties) !== AREA_TYPE.FACILITY) return [];
  const stored = properties?.facilities;
  if (Array.isArray(stored) || typeof stored === 'string') {
    return readFacilityKinds(stored);
  }
  const legacyKind = LEGACY_FACILITY_TYPES[properties?.type];
  return legacyKind ? [legacyKind] : [];
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
    const facilities =
      type === AREA_TYPE.FACILITY ? facilityKindsOf(feature.properties) : [];
    const code = (feature.properties?.code || '').trim();
    const area = Number(feature.properties?.area_m2);

    features.push({
      type: 'Feature',
      geometry: { type: 'MultiPolygon', coordinates: polygons },
      properties: {
        ...feature.properties,
        type,
        facilities,
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
