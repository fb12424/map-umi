import { AREA_COLOR, HOVER_COLOR, SELECTED_COLOR } from "../../lib/geoCommon.js";

export const SOURCE_ID = "editor-shops";
export const FLOOR_SOURCE = "editor-floor";
export const FILL_LAYER = "editor-shops-fill";
export const OUTLINE_LAYER = "editor-shops-outline";
export const FLOOR_LAYER = "editor-floor-fill";
export const DRAFT_SOURCE = "editor-draft";
export const DRAFT_FILL_LAYER = "editor-draft-fill";
export const DRAFT_LINE_LAYER = "editor-draft-line";
export const DRAFT_POINTS_LAYER = "editor-draft-points";

export const SNAP_PIXELS = 8;
export const MIN_RECT_PIXELS = 4;
export const ELLIPSE_SEGMENTS = 64;
export const HISTORY_LIMIT = 40;
export const ADD_MIN_FREE_M2 = 1;
export const ADD_MIN_FREE_RATIO = 0.05;

export const FILL_COLOR = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  ["boolean", ["feature-state", "hover"], false],
  HOVER_COLOR,
  AREA_COLOR,
];

export const EMPTY_DRAFT = { points: [], cursor: null, start: null, dragging: false };

export function filterSelection(selection, shops) {
  const uids = new Set(shops.features.map((feature) => feature.properties.uid));
  return selection.filter((uid) => uids.has(uid));
}

export function editorReducer(state, action) {
  switch (action.type) {
    case "select":
      return { ...state, selection: action.selection };
    case "commit":
      return {
        shops: action.shops,
        selection: filterSelection(action.selection ?? [], action.shops),
        past: [...state.past, state.shops].slice(-HISTORY_LIMIT),
      };
    case "undo": {
      if (!state.past.length) return state;
      const shops = state.past[state.past.length - 1];
      return {
        shops,
        selection: filterSelection(state.selection, shops),
        past: state.past.slice(0, -1),
      };
    }
    default:
      return state;
  }
}

export function rectangleRing(start, end) {
  return [
    [start.lng, start.lat],
    [end.lng, start.lat],
    [end.lng, end.lat],
    [start.lng, end.lat],
    [start.lng, start.lat],
  ];
}

export function ellipseRing(start, end) {
  const cx = (start.lng + end.lng) / 2;
  const cy = (start.lat + end.lat) / 2;
  const rx = Math.abs(end.lng - start.lng) / 2;
  const ry = Math.abs(end.lat - start.lat) / 2;
  const ring = [];

  for (let i = 0; i < ELLIPSE_SEGMENTS; i += 1) {
    const angle = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    ring.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

export function dedupePoints(points) {
  const result = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || last.lng !== point.lng || last.lat !== point.lat) {
      result.push(point);
    }
  }
  return result;
}

export const toXy = (point) => [point.lng, point.lat];
