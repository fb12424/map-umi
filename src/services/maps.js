const API_BASE = (process.env.API_BASE || "/api").replace(/\/+$/, "");

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      headers: { "Content-Type": "application/json" },
      ...options,
    });
  } catch {
    throw new Error("无法连接接口服务，请确认后端已启动");
  }

  let payload = null;
  try {
    payload = await response.json();
  } catch {
    // 非 JSON 响应交给 HTTP 状态判断
  }

  if (!response.ok || payload?.success === false) {
    const error = new Error(
      payload?.msg || `请求失败（HTTP ${response.status}）`,
    );
    error.status = response.status;
    throw error;
  }

  return payload?.data ?? null;
}

export function listMaps() {
  return request("/maps");
}

export function getMap(id) {
  return request(`/maps/${id}`);
}

export function getMapGeoJson(id) {
  return request(`/maps/${id}/geojson`);
}

export function getMapOutline(id) {
  return request(`/maps/${id}/outline`);
}

export function updateMap(id, input) {
  return request(`/maps/${id}`, {
    method: "PATCH",
    body: JSON.stringify(input),
  });
}

export function createMap(input) {
  return request("/maps", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function deleteMap(id) {
  return request(`/maps/${id}`, { method: "DELETE" });
}

