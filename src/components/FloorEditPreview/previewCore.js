// 预览层共用的常量与纯函数：图层/数据源 id、样式表达式、位号统计。
// 与 Hook 拆开是为了让 MapLibre 生命周期之外的逻辑保持无副作用，便于单独阅读和复用。
import {
  areaTypeOf,
  AREA_TYPE,
  findDuplicateCodes,
} from "../../lib/shopGeometry.js";
import {
  AREA_COLOR,
  HOVER_COLOR,
  OBSTACLE_COLOR,
  SELECTED_COLOR,
} from "../../lib/geoCommon.js";

// 数据源/图层 id 集中定义，重建数据时按同一组常量增删，避免漏删残留图层
export const SOURCE_ID = "preview-shops";
export const FLOOR_SOURCE = "preview-floor";
export const FILL_LAYER = "preview-shops-fill";
export const OUTLINE_LAYER = "preview-shops-outline";
export const FLOOR_FILL_LAYER = "preview-floor-fill";
// 清理顺序必须是"先图层后数据源"：MapLibre 不允许删除仍被图层引用的 source
export const ALL_LAYERS = [FILL_LAYER, OUTLINE_LAYER, FLOOR_FILL_LAYER];

// 低于该缩放级别时只保留联动铺位的标注，否则小铺位的标注会互相压盖糊成一片
export const LABEL_MIN_ZOOM = 16.3;

export const LINKED_COLOR = "#0ea5e9";
export const DUPLICATE_COLOR = "#dc2626";
// 描边用比填充更深的同色系，避免和填充颜色糊在一起
export const SELECTED_OUTLINE_COLOR = "#1d4ed8";
export const HOVER_OUTLINE_COLOR = "#f97316";
export const DUPLICATE_PROP = "duplicate_code";

// fill-color 的 case 表达式自上而下取第一个命中分支，优先级由此固定：
// 联动 > 选中 > hover > 重复位号 > 按面积分级色。
// linked/selected/hover 是 feature-state（只存在于运行时）；
// 重复位号用 feature 属性表达，这样重建图层、重新加载后标记依然生效。
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
  ["==", ["get", "type"], AREA_TYPE.OBSTACLE],
  OBSTACLE_COLOR,
  AREA_COLOR,
];

// 位号体检，结果供左上角统计卡展示。
// 只统计商铺：设施（电梯/厕所等）没有位号，混进来会把"无位号"数字撑大。
// duplicate 统计"重复了几种位号"，duplicateShops 统计"重复位号覆盖了几间铺位"，
// 两者缺一不可：前者提示数据问题种类，后者和图上红色铺位数对得上。
// 例：124 间铺位，6 间无位号，1F-101 重复 3 次、1F-118 重复 2 次
//     → missing=6，duplicate=2 种，duplicateShops=5 间，normal=124-6-5=113。
export function analyzeCodes(features) {
  const shopFeatures = features.filter(
    (feature) => areaTypeOf(feature.properties) === "shop",
  );
  const duplicated = new Set(findDuplicateCodes(shopFeatures));
  let normal = 0;
  let missing = 0;
  let duplicateShops = 0;

  for (const feature of shopFeatures) {
    const code = (feature.properties?.code || "").trim();
    if (!code) missing += 1;
    else if (duplicated.has(code)) duplicateShops += 1;
    else normal += 1;
  }

  return { normal, missing, duplicated, duplicateShops };
}

// 把重复位号写成 feature 属性，供样式表达式读取。
// 返回新对象而不是原地修改：父组件保存/导出用的仍是原始 geojson。
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

// 空 FeatureCollection（上传了但解析不出铺位）同样视为"没有楼板"，交给派生逻辑兜底
export function isValidFloor(floor) {
  return floor?.type === "FeatureCollection" && floor.features?.length > 0;
}

// 标注文案三级回退：完整位号 → 序号（对比模式）→ "未编号"
// 位号可能是 1F-101 / B1-101 等各种前缀，这里不做截断，原样展示
export const labelTextFor = (item, showUnnumberedIndex) => {
  if (item.codeText !== null) return item.codeText;
  return showUnnumberedIndex && item.index !== null
    ? `#${item.index}`
    : "未编号";
};

