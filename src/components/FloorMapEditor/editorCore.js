// 编辑器共享的常量与纯函数：图层 id、样式表达式、撤销栈 reducer、几何环生成。
// 与地图 Hook 分开，让不依赖 MapLibre 的部分可以单独阅读和复用。
import { AREA_COLOR, HOVER_COLOR, SELECTED_COLOR } from "../../lib/geoCommon.js";

// 数据源/图层 id 统一用 editor- 前缀，与预览组件的 preview-* 区分开，便于排查残留图层
export const SOURCE_ID = "editor-shops";
export const FLOOR_SOURCE = "editor-floor";
export const FILL_LAYER = "editor-shops-fill";
export const OUTLINE_LAYER = "editor-shops-outline";
export const FLOOR_LAYER = "editor-floor-fill";
// 绘制草稿：一个数据源 + 三个按 kind 过滤的图层，撤销/完成时只清这一份数据
export const DRAFT_SOURCE = "editor-draft";
export const DRAFT_FILL_LAYER = "editor-draft-fill";
export const DRAFT_LINE_LAYER = "editor-draft-line";
export const DRAFT_POINTS_LAYER = "editor-draft-points";

// 吸附半径（屏幕像素）：离已有顶点/边线这么近就把绘制点吸过去。
// 同一个阈值也用于判断"点回起点"闭合多边形、以及二次点击的落点是否有效
export const SNAP_PIXELS = 8;
// 拖拽矩形/椭圆时，宽或高小于该像素数视为误触，直接丢弃
export const MIN_RECT_PIXELS = 4;
// 椭圆用 64 段折线近似；段数越多越圆滑，但生成的顶点也越多
export const ELLIPSE_SEGMENTS = 64;
// 撤销栈最多保留的快照数，持续编辑时防止快照无限堆积
export const HISTORY_LIMIT = 40;
// 新增铺位的"有效空闲面积"门槛：扣掉已有铺位后至少剩 1㎡、且不低于圈选面积的 5%，
// 否则多半是圈到了缝隙或误触，不生成碎条铺位
export const ADD_MIN_FREE_M2 = 1;
export const ADD_MIN_FREE_RATIO = 0.05;

// 编辑器只区分两种运行时状态，优先级：选中（蓝）> 悬停（橙）> 按面积分级色。
// 编辑时不展示"重复位号"等数据体检信息，避免和操作反馈抢视觉焦点
export const FILL_COLOR = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  ["boolean", ["feature-state", "hover"], false],
  HOVER_COLOR,
  AREA_COLOR,
];

// 绘制草稿的初始形态：points 是已落定的点（{lng, lat}），cursor 是跟随鼠标的预览点，
// start/dragging 只在矩形、椭圆按住拖拽时使用
export const EMPTY_DRAFT = { points: [], cursor: null, start: null, dragging: false };

// 删除、合并、裁切之后部分铺位 uid 已不存在，选区和撤销栈都要剔除这些失效 uid，
// 否则后续操作会对着不存在的要素执行
export function filterSelection(selection, shops) {
  const uids = new Set(shops.features.map((feature) => feature.properties.uid));
  return selection.filter((uid) => uids.has(uid));
}

// 只保存铺位集合的快照，不单独保存选区：
// undo 时选区按恢复后的数据重新过滤，避免恢复出已不存在的选中项
export function editorReducer(state, action) {
  switch (action.type) {
    case "select":
      return { ...state, selection: action.selection };
    // 每次图元操作都产出全新的 FeatureCollection，旧的 shops 入栈
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

// 以拖拽起止点生成矩形环；坐标为 GeoJSON 顺序 [lng, lat]，首尾闭合
export function rectangleRing(start, end) {
  return [
    [start.lng, start.lat],
    [end.lng, start.lat],
    [end.lng, end.lat],
    [start.lng, end.lat],
    [start.lng, start.lat],
  ];
}

// 以拖拽起止点为外接框生成椭圆（64 段折线近似），同样首尾闭合
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

// 只合并"相邻"的重复点，不处理隔开的同坐标点：
// 双击闭合时浏览器会先发两次 click 再发 dblclick，第二次 click 常把同一个点再加一遍
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

// 草稿内部用 {lng, lat} 便于 map.project 计算，写进 GeoJSON 前统一转成 [lng, lat]
export const toXy = (point) => [point.lng, point.lat];
