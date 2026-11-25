const METERS_PER_DEGREE_LAT = 110540;
const METERS_PER_DEGREE_LON = 111320;
const WALK_SPEED_MPS = 1.2;
const PREFERRED_CLEARANCE_METERS = 1.8;
const CLEARANCE_WEIGHT = 4;
const MIN_SMOOTH_CLEARANCE_METERS = 0.6;
const ENDPOINT_CLEARANCE_ZONE = 1.5;

const NEIGHBORS = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

function geometryPolygons(geometry) {
  if (!geometry) return [];
  if (geometry.type === 'Polygon') return [geometry.coordinates];
  if (geometry.type === 'MultiPolygon') return geometry.coordinates;
  if (geometry.type === 'GeometryCollection') {
    return (geometry.geometries ?? []).flatMap(geometryPolygons);
  }
  return [];
}

function createProjection(lat0, lon0) {
  const kx = METERS_PER_DEGREE_LON * Math.cos((lat0 * Math.PI) / 180);
  return {
    forward: ([lng, lat]) => [(lng - lon0) * kx, (lat - lat0) * METERS_PER_DEGREE_LAT],
    inverse: ([x, y]) => [lon0 + x / kx, lat0 + y / METERS_PER_DEGREE_LAT],
  };
}

function pointInRing(x, y, ring) {
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

function pointInPolygon(x, y, polygon) {
  if (!pointInRing(x, y, polygon[0])) return false;
  for (let i = 1; i < polygon.length; i += 1) {
    if (pointInRing(x, y, polygon[i])) return false;
  }
  return true;
}

function ringBounds(rings) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const ring of rings) {
    for (const [x, y] of ring) {
      if (x < minX) minX = x;
      if (y < minY) minY = y;
      if (x > maxX) maxX = x;
      if (y > maxY) maxY = y;
    }
  }
  return { minX, minY, maxX, maxY };
}

function buildFloorDistance(grid) {
  const { width, height, cellSize, solid } = grid;
  const distance = new Float32Array(width * height).fill(Infinity);
  const heap = [];

  const push = (node) => {
    heap.push(node);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (distance[heap[parent]] <= distance[heap[i]]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let min = i;
        if (left < heap.length && distance[heap[left]] < distance[heap[min]]) min = left;
        if (right < heap.length && distance[heap[right]] < distance[heap[min]]) min = right;
        if (min === i) break;
        [heap[min], heap[i]] = [heap[i], heap[min]];
        i = min;
      }
    }
    return top;
  };

  for (let i = 0; i < solid.length; i += 1) {
    if (!solid[i]) {
      distance[i] = 0;
      push(i);
    }
  }

  while (heap.length) {
    const current = pop();
    const base = distance[current];
    const x = current % width;
    const y = (current / width) | 0;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!solid[next]) continue;
      const value = base + cost * cellSize;
      if (value < distance[next]) {
        distance[next] = value;
        push(next);
      }
    }
  }

  return distance;
}

function buildShopDistanceField(grid, inShop, allowed) {
  const { width, height, cellSize } = grid;
  const distance = new Float32Array(width * height).fill(Infinity);
  const queue = [];

  for (let cell = 0; cell < inShop.length; cell += 1) {
    if (inShop[cell]) {
      distance[cell] = 0;
      queue.push(cell);
    }
  }

  for (let head = 0; head < queue.length; head += 1) {
    const current = queue[head];
    const base = distance[current];
    const x = current % width;
    const y = (current / width) | 0;
    for (const [dx, dy] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (!allowed[next]) continue;
      const value = base + cellSize;
      if (value < distance[next]) {
        distance[next] = value;
        queue.push(next);
      }
    }
  }

  return distance;
}

function clearancePenalty(distance) {
  if (!Number.isFinite(distance) || distance >= PREFERRED_CLEARANCE_METERS) return 1;
  return 1 + CLEARANCE_WEIGHT * (1 - distance / PREFERRED_CLEARANCE_METERS);
}

function floodFill(grid, walkable) {
  const { width, height } = grid;
  const comp = new Int32Array(width * height).fill(-1);
  const sizes = [];
  const queue = [];

  for (let start = 0; start < walkable.length; start += 1) {
    if (!walkable[start] || comp[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    comp[start] = id;
    queue.length = 0;
    queue.push(start);
    for (let head = 0; head < queue.length; head += 1) {
      const current = queue[head];
      size += 1;
      const x = current % width;
      const y = (current / width) | 0;
      if (x > 0) {
        const next = current - 1;
        if (walkable[next] && comp[next] === -1) { comp[next] = id; queue.push(next); }
      }
      if (x + 1 < width) {
        const next = current + 1;
        if (walkable[next] && comp[next] === -1) { comp[next] = id; queue.push(next); }
      }
      if (y > 0) {
        const next = current - width;
        if (walkable[next] && comp[next] === -1) { comp[next] = id; queue.push(next); }
      }
      if (y + 1 < height) {
        const next = current + width;
        if (walkable[next] && comp[next] === -1) { comp[next] = id; queue.push(next); }
      }
    }
    sizes.push(size);
  }

  let main = -1;
  let best = 0;
  for (let i = 0; i < sizes.length; i += 1) {
    if (sizes[i] > best) { best = sizes[i]; main = i; }
  }
  return { comp, main };
}

export function buildNavGrid(shopFeatures, floorGeojson, options = {}) {
  const cellSize = options.cellSize ?? 0.5;
  const exteriorMargin = options.exteriorMargin ?? 4;
  const floorFeatures = floorGeojson?.features ?? [];
  const lngLatPolygons = floorFeatures.flatMap((feature) => geometryPolygons(feature.geometry));
  if (!lngLatPolygons.length) throw new Error('缺少楼板数据，无法生成导航区域');

  let minLng = Infinity;
  let minLat = Infinity;
  let maxLng = -Infinity;
  let maxLat = -Infinity;
  for (const polygon of lngLatPolygons) {
    for (const [lng, lat] of polygon[0]) {
      if (lng < minLng) minLng = lng;
      if (lat < minLat) minLat = lat;
      if (lng > maxLng) maxLng = lng;
      if (lat > maxLat) maxLat = lat;
    }
  }

  const projection = createProjection((minLat + maxLat) / 2, (minLng + maxLng) / 2);
  const floorPolygons = lngLatPolygons.map((polygon) =>
    polygon.map((ring) => ring.map(projection.forward)),
  );
  const floorBounds = ringBounds(floorPolygons.map((polygon) => polygon[0]));
  const padding = cellSize * 2;
  const minX = floorBounds.minX - padding;
  const minY = floorBounds.minY - padding;
  const width = Math.ceil((floorBounds.maxX - floorBounds.minX + padding * 2) / cellSize);
  const height = Math.ceil((floorBounds.maxY - floorBounds.minY + padding * 2) / cellSize);

  const grid = {
    cellSize,
    width,
    height,
    minX,
    minY,
    project: projection.forward,
    inverse: projection.inverse,
    comp: null,
    main: -1,
  };

  const cells = width * height;
  const inFloor = new Uint8Array(cells);
  const solid = new Uint8Array(cells);
  const hasHoles = floorPolygons.some((polygon) => polygon.length > 1);

  for (let j = 0; j < height; j += 1) {
    const y = minY + (j + 0.5) * cellSize;
    for (let i = 0; i < width; i += 1) {
      const x = minX + (i + 0.5) * cellSize;
      const cell = j * width + i;
      if (floorPolygons.some((polygon) => pointInPolygon(x, y, polygon))) {
        inFloor[cell] = 1;
      }
      if (!hasHoles || inFloor[cell]) {
        solid[cell] = inFloor[cell];
      } else if (floorPolygons.some((polygon) => pointInRing(x, y, polygon[0]))) {
        solid[cell] = 1;
      }
    }
  }

  const shopPolygons = [];
  for (const feature of shopFeatures ?? []) {
    for (const polygon of geometryPolygons(feature.geometry)) {
      const projected = polygon.map((ring) => ring.map(projection.forward));
      shopPolygons.push({ polygon: projected, bounds: ringBounds([projected[0]]) });
    }
  }

  const inShop = new Uint8Array(cells);
  for (const { polygon, bounds } of shopPolygons) {
    const i0 = Math.max(0, Math.floor((bounds.minX - minX) / cellSize));
    const i1 = Math.min(width - 1, Math.floor((bounds.maxX - minX) / cellSize));
    const j0 = Math.max(0, Math.floor((bounds.minY - minY) / cellSize));
    const j1 = Math.min(height - 1, Math.floor((bounds.maxY - minY) / cellSize));
    for (let j = j0; j <= j1; j += 1) {
      const y = minY + (j + 0.5) * cellSize;
      for (let i = i0; i <= i1; i += 1) {
        const cell = j * width + i;
        if (inShop[cell]) continue;
        const x = minX + (i + 0.5) * cellSize;
        if (pointInPolygon(x, y, polygon)) inShop[cell] = 1;
      }
    }
  }

  grid.solid = solid;
  const distance = buildFloorDistance(grid);
  delete grid.solid;

  const candidate = new Uint8Array(cells);
  for (let i = 0; i < cells; i += 1) {
    candidate[i] = inFloor[i] && !inShop[i] ? 1 : 0;
  }
  const shopDistance = buildShopDistanceField(grid, inShop, candidate);

  const walkable = new Uint8Array(cells);
  for (let i = 0; i < cells; i += 1) {
    walkable[i] = candidate[i] && distance[i] >= exteriorMargin ? 1 : 0;
  }
  const { comp, main } = floodFill(grid, walkable);
  if (main === -1) throw new Error('没有找到可行走区域');

  grid.walkable = walkable;
  grid.shopDistance = shopDistance;
  grid.comp = comp;
  grid.main = main;
  return grid;
}

function cellCenter(grid, cell) {
  const x = cell % grid.width;
  const y = (cell / grid.width) | 0;
  return {
    x: grid.minX + (x + 0.5) * grid.cellSize,
    y: grid.minY + (y + 0.5) * grid.cellSize,
  };
}

export function snapToMain(grid, lngLat) {
  const [px, py] = grid.project(lngLat);
  const sx = Math.floor((px - grid.minX) / grid.cellSize);
  const sy = Math.floor((py - grid.minY) / grid.cellSize);
  let best = -1;
  let bestDistance = Infinity;

  for (let j = 0; j < grid.height; j += 1) {
    for (let i = 0; i < grid.width; i += 1) {
      const cell = j * grid.width + i;
      if (grid.comp[cell] !== grid.main) continue;
      const dx = i - sx;
      const dy = j - sy;
      const distance = dx * dx + dy * dy;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = cell;
      }
    }
  }

  if (best === -1) return null;
  const center = cellCenter(grid, best);
  return { cell: best, ...center };
}

function octile(dx, dy) {
  return dx + dy + (Math.SQRT2 - 2) * Math.min(dx, dy);
}

function findPath(grid, startCell, endCell) {
  const { width, height, comp, main } = grid;
  const total = width * height;
  const gScore = new Float64Array(total).fill(Infinity);
  const fScore = new Float64Array(total).fill(Infinity);
  const cameFrom = new Int32Array(total).fill(-1);
  const closed = new Uint8Array(total);
  const heap = [];

  const targetX = endCell % width;
  const targetY = (endCell / width) | 0;
  const heuristic = (cell) => {
    const x = cell % width;
    const y = (cell / width) | 0;
    return octile(Math.abs(x - targetX), Math.abs(y - targetY));
  };

  const push = (cell) => {
    heap.push(cell);
    let i = heap.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (fScore[heap[parent]] <= fScore[heap[i]]) break;
      [heap[parent], heap[i]] = [heap[i], heap[parent]];
      i = parent;
    }
  };

  const pop = () => {
    const top = heap[0];
    const last = heap.pop();
    if (heap.length) {
      heap[0] = last;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let min = i;
        if (left < heap.length && fScore[heap[left]] < fScore[heap[min]]) min = left;
        if (right < heap.length && fScore[heap[right]] < fScore[heap[min]]) min = right;
        if (min === i) break;
        [heap[min], heap[i]] = [heap[i], heap[min]];
        i = min;
      }
    }
    return top;
  };

  gScore[startCell] = 0;
  fScore[startCell] = heuristic(startCell);
  push(startCell);

  while (heap.length) {
    const current = pop();
    if (closed[current]) continue;
    closed[current] = 1;
    if (current === endCell) break;

    const x = current % width;
    const y = (current / width) | 0;
    for (const [dx, dy, cost] of NEIGHBORS) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= width || ny >= height) continue;
      const next = ny * width + nx;
      if (closed[next] || comp[next] !== main) continue;
      if (dx && dy) {
        if (comp[y * width + nx] !== main || comp[ny * width + x] !== main) continue;
      }
      const nextScore = gScore[current] + cost * clearancePenalty(grid.shopDistance[next]);
      if (nextScore >= gScore[next]) continue;
      gScore[next] = nextScore;
      fScore[next] = nextScore + heuristic(next);
      cameFrom[next] = current;
      push(next);
    }
  }

  if (!closed[endCell]) return null;
  const path = [];
  for (let cell = endCell; cell !== -1; cell = cameFrom[cell]) path.push(cell);
  return path.reverse();
}

function canSee(grid, from, to, routeStart, routeEnd) {
  const distance = Math.hypot(to.x - from.x, to.y - from.y);
  const steps = Math.max(1, Math.ceil(distance / (grid.cellSize * 0.5)));
  for (let step = 1; step < steps; step += 1) {
    const t = step / steps;
    const x = from.x + (to.x - from.x) * t;
    const y = from.y + (to.y - from.y) * t;
    const i = Math.floor((x - grid.minX) / grid.cellSize);
    const j = Math.floor((y - grid.minY) / grid.cellSize);
    if (i < 0 || j < 0 || i >= grid.width || j >= grid.height) return false;
    const cell = j * grid.width + i;
    if (grid.comp[cell] !== grid.main) return false;
    if (grid.shopDistance[cell] < MIN_SMOOTH_CLEARANCE_METERS) {
      const nearStart =
        Math.hypot(x - routeStart.x, y - routeStart.y) <= ENDPOINT_CLEARANCE_ZONE;
      const nearEnd =
        Math.hypot(x - routeEnd.x, y - routeEnd.y) <= ENDPOINT_CLEARANCE_ZONE;
      if (!nearStart && !nearEnd) return false;
    }
  }
  return true;
}

function simplifyPath(grid, path) {
  const points = path.map((cell) => cellCenter(grid, cell));
  if (points.length <= 2) return points;
  const routeStart = points[0];
  const routeEnd = points[points.length - 1];
  const result = [points[0]];
  let index = 0;
  while (index < points.length - 1) {
    let next = points.length - 1;
    while (next > index + 1 && !canSee(grid, points[index], points[next], routeStart, routeEnd)) {
      next -= 1;
    }
    result.push(points[next]);
    index = next;
  }
  return result;
}

function normalize(dx, dy) {
  const length = Math.hypot(dx, dy) || 1;
  return [dx / length, dy / length];
}

function ribbonRing(points, halfWidth) {
  if (points.length < 2) return null;
  const left = [];
  const right = [];

  for (let i = 0; i < points.length; i += 1) {
    let nx;
    let ny;
    if (i === 0) {
      const [dx, dy] = normalize(points[1].x - points[0].x, points[1].y - points[0].y);
      nx = -dy;
      ny = dx;
    } else if (i === points.length - 1) {
      const [dx, dy] = normalize(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
      nx = -dy;
      ny = dx;
    } else {
      const [ax, ay] = normalize(
        points[i].x - points[i - 1].x,
        points[i].y - points[i - 1].y,
      );
      const [bx, by] = normalize(
        points[i + 1].x - points[i].x,
        points[i + 1].y - points[i].y,
      );
      const prevX = -ay;
      const prevY = ax;
      let mx = prevX - by;
      let my = prevY + bx;
      const length = Math.hypot(mx, my);
      if (length < 1e-6) {
        nx = prevX;
        ny = prevY;
      } else {
        mx /= length;
        my /= length;
        const dot = mx * prevX + my * prevY;
        const scale = 1 / Math.max(0.35, Math.abs(dot));
        nx = mx * scale;
        ny = my * scale;
      }
    }

    left.push({ x: points[i].x + nx * halfWidth, y: points[i].y + ny * halfWidth });
    right.push({ x: points[i].x - nx * halfWidth, y: points[i].y - ny * halfWidth });
  }

  return left.concat(right.reverse());
}

export function findRoute(grid, fromLngLat, toLngLat, options = {}) {
  if (!grid) throw new Error('导航区域尚未准备好');
  const halfWidth = options.halfWidth ?? 0.4;
  const start = snapToMain(grid, fromLngLat);
  const end = snapToMain(grid, toLngLat);
  if (!start || !end) throw new Error('起终点附近没有可行走区域');

  if (start.cell === end.cell) {
    const point = grid.inverse([start.x, start.y]);
    return {
      coordinates: [point, point],
      ribbon: null,
      distance: 0,
      duration: 0,
      startPoint: point,
      endPoint: point,
    };
  }

  const path = findPath(grid, start.cell, end.cell);
  if (!path) throw new Error('两个铺位之间没有可通行路线');

  const points = simplifyPath(grid, path);
  let distance = 0;
  for (let i = 1; i < points.length; i += 1) {
    distance += Math.hypot(
      points[i].x - points[i - 1].x,
      points[i].y - points[i - 1].y,
    );
  }

  const ring = ribbonRing(points, halfWidth);
  const ribbon = ring
    ? ring.map(({ x, y }) => grid.inverse([x, y])).concat([grid.inverse([ring[0].x, ring[0].y])])
    : null;

  return {
    coordinates: points.map(({ x, y }) => grid.inverse([x, y])),
    ribbon,
    distance,
    duration: distance / WALK_SPEED_MPS,
    startPoint: grid.inverse([points[0].x, points[0].y]),
    endPoint: grid.inverse([points[points.length - 1].x, points[points.length - 1].y]),
  };
}