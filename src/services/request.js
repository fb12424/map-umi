const API_BASE = (process.env.API_BASE || "/api").replace(/\/+$/, "");

export async function request(path, options = {}) {
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
