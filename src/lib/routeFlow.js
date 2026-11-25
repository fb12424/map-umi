const METERS_PER_DEGREE_LAT = 110540;
const METERS_PER_DEGREE_LON = 111320;

// 把经纬度折线投影到以首点为原点的米制平面，预先算好每段的长度，
// 之后按沿线距离取样时不用再反复遍历经纬度
export function measureRoute(coordinates) {
  if (!coordinates || coordinates.length < 2) return null;

  const [lon0, lat0] = coordinates[0];
  const scaleX = METERS_PER_DEGREE_LON * Math.cos((lat0 * Math.PI) / 180);
  const points = coordinates.map(([lng, lat]) => [
    (lng - lon0) * scaleX,
    (lat - lat0) * METERS_PER_DEGREE_LAT,
  ]);

  const segments = [];
  let total = 0;
  for (let i = 1; i < points.length; i += 1) {
    const [x0, y0] = points[i - 1];
    const [x1, y1] = points[i];
    const length = Math.hypot(x1 - x0, y1 - y0);
    if (length < 1e-6) continue;
    segments.push({
      x0,
      y0,
      x1,
      y1,
      start: total,
      length,
    });
    total += length;
  }
  if (!segments.length) return null;

  return { lon0, lat0, scaleX, segments, total };
}

// 按沿线距离取点，返回 [lng, lat]
function sampleAlong(route, distance) {
  const d = Math.min(Math.max(distance, 0), route.total);
  const segment =
    route.segments.find((item) => d <= item.start + item.length) ??
    route.segments[route.segments.length - 1];
  const t = Math.min(Math.max((d - segment.start) / segment.length, 0), 1);
  const x = segment.x0 + (segment.x1 - segment.x0) * t;
  const y = segment.y0 + (segment.y1 - segment.y0) * t;
  return [route.lon0 + x / route.scaleX, route.lat0 + y / METERS_PER_DEGREE_LAT];
}

// 沿整条路线均匀排布圆点：整数个间距能整除总长，回绕处也保持等距
export function routeDotSamples(route, traveled, targetSpacing = 12) {
  const count = Math.max(2, Math.round(route.total / targetSpacing));
  const spacing = route.total / count;
  const phase = ((traveled % route.total) + route.total) % route.total;

  const samples = [];
  for (let i = 0; i < count; i += 1) {
    samples.push(sampleAlong(route, (phase + i * spacing) % route.total));
  }
  return samples;
}
