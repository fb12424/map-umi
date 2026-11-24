import {
  AREA_TYPE,
  AREA_TYPE_LABEL,
  areaTypeOf,
} from "../../lib/shopGeometry.js";
import {
  AREA_COLOR,
  CORRIDOR_COLOR,
  HOVER_COLOR,
  OBSTACLE_COLOR,
  SELECTED_COLOR,
  merchantNameOf,
} from "../../lib/geoCommon.js";

export const SOURCE_ID = "preview-shops";
export const FLOOR_SOURCE = "preview-floor";
export const FILL_LAYER = "preview-shops-fill";
export const OUTLINE_LAYER = "preview-shops-outline";
export const FLOOR_FILL_LAYER = "preview-floor-fill";
export const FLOOR_EXTRUSION_LAYER = "preview-floor-extrusion";
export const SHOPS_EXTRUSION_LAYER = "preview-shops-extrusion";
export const NAV_ROUTE_SOURCE = "preview-nav-route";
export const NAV_ROUTE_CASING_LAYER = "preview-nav-route-casing";
export const NAV_ROUTE_LINE_LAYER = "preview-nav-route-line";
export const NAV_ROUTE_RIBBON_LAYER = "preview-nav-route-ribbon";
export const NAV_LINE_LAYERS = [NAV_ROUTE_CASING_LAYER, NAV_ROUTE_LINE_LAYER];
export const ALL_LAYERS = [
  FILL_LAYER,
  OUTLINE_LAYER,
  SHOPS_EXTRUSION_LAYER,
  FLOOR_FILL_LAYER,
  FLOOR_EXTRUSION_LAYER,
  NAV_ROUTE_CASING_LAYER,
  NAV_ROUTE_LINE_LAYER,
  NAV_ROUTE_RIBBON_LAYER,
];
export const ALL_SOURCES = [SOURCE_ID, FLOOR_SOURCE, NAV_ROUTE_SOURCE];
export const LABEL_MIN_ZOOM = 16.3;

export const FLOOR_HEIGHT = 0.25;
export const SHOP_HEIGHT = 1.5;
export const SELECTED_SHOP_HEIGHT = 2;
export const PITCH_3D = 55;
export const BEARING_3D = -18;
export const PITCH_ZOOM_BOOST = 0.45;

export const CORRIDOR_COLOR_2D = CORRIDOR_COLOR;
export const CORRIDOR_COLOR_3D = "#f1e0c0";
export const NAV_ROUTE_COLOR = "#0f766e";
export const NAV_START_COLOR = "#16a34a";
export const NAV_END_COLOR = "#dc2626";
export const NAV_ROUTE_HALF_WIDTH = 0.4;

export const FILL_COLOR = [
  "case",
  ["boolean", ["feature-state", "start"], false],
  NAV_START_COLOR,
  ["boolean", ["feature-state", "end"], false],
  NAV_END_COLOR,
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  ["boolean", ["feature-state", "hover"], false],
  HOVER_COLOR,
  ["==", ["get", "type"], AREA_TYPE.OBSTACLE],
  OBSTACLE_COLOR,
  AREA_COLOR,
];

export const EXTRUSION_COLOR = [
  "case",
  ["boolean", ["feature-state", "start"], false],
  NAV_START_COLOR,
  ["boolean", ["feature-state", "end"], false],
  NAV_END_COLOR,
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  ["boolean", ["feature-state", "hover"], false],
  "#f97316",
  ["==", ["get", "type"], AREA_TYPE.OBSTACLE],
  OBSTACLE_COLOR,
  AREA_COLOR,
];

const numberFormat = new Intl.NumberFormat("zh-CN", {
  maximumFractionDigits: 0,
});

export function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

export const merchantNoOf = (properties) =>
  (properties.merchantNo || "").trim();

export const isMerchantLinked = (properties) =>
  Boolean(merchantNameOf(properties) || merchantNoOf(properties));

export function buildPopupContent(properties) {
  const wrap = document.createElement("div");
  wrap.className = "fp-popup-inner";

  const code = document.createElement("div");
  code.className = "fp-popup-code";
  const type = areaTypeOf(properties);
  code.textContent =
    type === AREA_TYPE.OBSTACLE
      ? AREA_TYPE_LABEL[type]
      : properties.label || properties.code || "未编号";
  wrap.appendChild(code);

  const merchantName = merchantNameOf(properties);
  const merchantNo = merchantNoOf(properties);
  if (merchantName || merchantNo) {
    const merchant = document.createElement("div");
    merchant.className = "fp-popup-merchant";
    merchant.textContent = [merchantName, merchantNo]
      .filter(Boolean)
      .join(" · ");
    wrap.appendChild(merchant);
  }

  // const meta = document.createElement("div");
  // meta.className = "fp-popup-meta";
  // meta.textContent = `${Number(properties.area_m2).toFixed(1)} m²`;
  // wrap.appendChild(meta);

  return wrap;
}

export { numberFormat };

