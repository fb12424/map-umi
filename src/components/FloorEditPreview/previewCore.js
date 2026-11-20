import { findDuplicateCodes, labelWidth } from "../../lib/shopGeometry.js";
import {
  AREA_COLOR,
  HOVER_COLOR,
  SELECTED_COLOR,
} from "../../lib/geoCommon.js";

export const SOURCE_ID = "preview-shops";
export const FLOOR_SOURCE = "preview-floor";
export const FILL_LAYER = "preview-shops-fill";
export const OUTLINE_LAYER = "preview-shops-outline";
export const FLOOR_FILL_LAYER = "preview-floor-fill";
export const ALL_LAYERS = [FILL_LAYER, OUTLINE_LAYER, FLOOR_FILL_LAYER];
export const LABEL_MIN_ZOOM = 16.3;

export const LINKED_COLOR = "#0ea5e9";
export const DUPLICATE_COLOR = "#dc2626";
export const DUPLICATE_PROP = "duplicate_code";

export const FILL_COLOR = [
  "case",
  ["boolean", ["feature-state", "linked"], false],
  LINKED_COLOR,
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  ["boolean", ["feature-state", "hover"], false],
  HOVER_COLOR,
  ["boolean", ["get", DUPLICATE_PROP], false],
  DUPLICATE_COLOR,
  AREA_COLOR,
];

export function analyzeCodes(features) {
  const duplicated = new Set(findDuplicateCodes(features));
  let normal = 0;
  let missing = 0;

  for (const feature of features) {
    const code = (feature.properties?.code || "").trim();
    if (!code) missing += 1;
    else if (!duplicated.has(code)) normal += 1;
  }

  return { normal, missing, duplicated };
}

export function markDuplicates(geojson, duplicated) {
  if (!duplicated.size) return geojson;
  return {
    ...geojson,
    features: geojson.features.map((feature) =>
      duplicated.has((feature.properties?.code || "").trim())
        ? {
            ...feature,
            properties: { ...feature.properties, [DUPLICATE_PROP]: true },
          }
        : feature,
    ),
  };
}

export function isValidFloor(floor) {
  return floor?.type === "FeatureCollection" && floor.features?.length > 0;
}

export const labelTextFor = (item, showUnnumberedIndex) => {
  if (item.codeText !== null) return item.codeText;
  return showUnnumberedIndex && item.index !== null
    ? `#${item.index}`
    : "未编号";
};

export function renderLabelContent(el, text, merchantName) {
  el.textContent = "";

  const code = document.createElement("span");
  code.className = "shop-label-code";
  code.textContent = text;
  el.appendChild(code);

  el.classList.toggle("has-merchant", Boolean(merchantName));
  if (!merchantName) return;

  const merchant = document.createElement("span");
  merchant.className = "shop-label-merchant";
  merchant.textContent = merchantName;
  el.appendChild(merchant);
}

export function labelSize(text, merchantName) {
  return {
    width: Math.max(labelWidth(text), merchantName ? labelWidth(merchantName) : 0),
    height: merchantName ? 34 : 22,
  };
}
