import { request } from "./request.js";

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

