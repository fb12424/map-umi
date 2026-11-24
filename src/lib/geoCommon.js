import { LngLatBounds } from "maplibre-gl";

export const CORRIDOR_COLOR = "#f4e5c9";
export const HOVER_COLOR = "#f2a33a";
export const SELECTED_COLOR = "#2563eb";
// 障碍区用中性灰，和营业铺位（蓝色系）明显区分
export const OBSTACLE_COLOR = "#c8d1da";
export const OBSTACLE_OUTLINE_COLOR = "#c8d1da";

export const AREA_COLOR = [
  "step",
  ["coalesce", ["get", "area_m2"], 0],
  "#c3d9f2",
  30,
  "#98bde8",
  60,
  "#6597d7",
  120,
  "#3c72bb",
  200,
  "#1d4a8f",
];

export function featureBounds(features) {
  const bounds = new LngLatBounds();
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      bounds.extend(coords);
      return;
    }
    coords.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  return bounds;
}

export const merchantNameOf = (properties) =>
  (properties.merchantName || properties.shopName || properties.brand || "").trim();
