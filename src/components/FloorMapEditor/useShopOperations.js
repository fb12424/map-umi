// 图元操作层：每次操作都算出"下一份铺位集合"后 dispatch commit，
// 由 reducer 统一压撤销栈，所以这里全程不原地修改数据。
// 几何运算复用 lib/polygonOps.js，位号/商户等属性在"保留的那部分"上原样继承。
import { useEffect, useRef } from "react";
import { message } from "antd";
import {
  areaChanged,
  cleanPolygons,
  createShopFeature,
  geometryToPolygons,
  nextShopUid,
  pointInPolygons,
  pointOnBoundary,
  polygonsAreaM2,
  splitPolygonsByLine,
  subtractPolygons,
  unionPolygons,
  updateShopGeometry,
} from "../../lib/polygonOps.js";
import { isShopFeature, labelPoint } from "../../lib/shopGeometry.js";
import { ADD_MIN_FREE_M2, ADD_MIN_FREE_RATIO } from "./editorCore.js";

// 切线/多片拆分生成的新要素属性：商铺置空位号待录，
// 设施沿用原类型与名称，避免把厕所/电梯拆成无名空铺位
function derivedPartProps(properties) {
  if (isShopFeature(properties)) {
    return { code: "", merchantNo: "", merchantName: "" };
  }
  return {
    type: properties.type,
    name: properties.name || "",
    areaNo: properties.areaNo || "",
    toiletType: properties.toiletType || "",
    shaftId: properties.shaftId || "",
    code: "",
    merchantNo: "",
    merchantName: "",
  };
}

export default function useShopOperations({ dispatch, shops, selection }) {
  // 操作可能由地图事件触发，统一从 ref 读最新的铺位/选区
  const shopsRef = useRef(shops);
  const selectionRef = useRef(selection);
  // "全部铺位占用区域"的并集较重，按 shops 引用做缓存；shops 一换缓存即失效
  const occupiedRef = useRef({ shops: null, polygons: [] });

  shopsRef.current = shops;
  selectionRef.current = selection;

  useEffect(() => {
    occupiedRef.current = { shops: null, polygons: [] };
  }, [shops]);

  const getOccupiedPolygons = () => {
    if (occupiedRef.current.shops === shopsRef.current) {
      return occupiedRef.current.polygons;
    }
    // 新增铺位时要把"所有已有铺位"从圈选区域里扣掉；先合并成并集，
    // 后续差集只需处理一组较少的轮廓
    const polygons = unionPolygons(
      shopsRef.current.features.flatMap((feature) =>
        geometryToPolygons(feature.geometry),
      ),
    );
    occupiedRef.current = { shops: shopsRef.current, polygons };
    return polygons;
  };

  // 裁切 = 所选铺位减去圈选形状。完全被圈掉的铺位删除；
  // 面积几乎没变化的（例如圈选完全在别的铺位里）视为没裁到，保持原样
  const applyCrop = (shapePolygon) => {
    const selected = new Set(selectionRef.current);
    if (!selected.size) {
      message.warning("请先在“选择”模式下选中要裁切的铺位");
      return;
    }

    let changed = 0;
    let removed = 0;
    const nextFeatures = [];

    for (const feature of shopsRef.current.features) {
      if (!selected.has(feature.properties.uid)) {
        nextFeatures.push(feature);
        continue;
      }

      const polygons = geometryToPolygons(feature.geometry);
      const beforeArea = polygonsAreaM2(polygons);
      const result = cleanPolygons(subtractPolygons(polygons, shapePolygon));

      // 结果为空 = 整间铺位都被圈掉了，删掉并提示数量
      if (!result.length) {
        changed += 1;
        removed += 1;
        continue;
      }

      const afterArea = polygonsAreaM2(result);
      // 面积变化小于阈值（0.01㎡）视为没裁到，保留原要素避免无意义的历史记录
      if (!areaChanged(beforeArea, afterArea)) {
        nextFeatures.push(feature);
        continue;
      }

      // 保留原 uid 和属性，只替换几何并重算面积
      nextFeatures.push(updateShopGeometry(feature, result));
      changed += 1;
    }

    if (!changed) {
      message.info("所选铺位与圈选区域没有重叠");
      return;
    }

    const uids = new Set(nextFeatures.map((feature) => feature.properties.uid));
    // 选区过滤掉被完全移除的铺位，剩下被裁过的继续处于选中态
    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [...selected].filter((uid) => uids.has(uid)),
    });
    message.success(
      `已裁切 ${changed} 个铺位${removed ? `，${removed} 个被完全移除` : ""}`,
    );
  };

  // 新增 = 圈选形状减去所有已有铺位，只保留真正空闲的部分。
  // 空闲面积太小（<1㎡ 或不足圈选的 5%）说明圈到了缝隙/误触，不生成碎条
  const applyAdd = (shapePolygon) => {
    const occupied = getOccupiedPolygons();
    const result = cleanPolygons(subtractPolygons(shapePolygon, occupied));
    const shapeArea = polygonsAreaM2(shapePolygon);
    const freeArea = polygonsAreaM2(result);
    if (
      !result.length ||
      freeArea < ADD_MIN_FREE_M2 ||
      freeArea / shapeArea < ADD_MIN_FREE_RATIO
    ) {
      message.warning("圈选区域已被现有铺位占满，未新增铺位");
      return;
    }

    const uid = nextShopUid(shopsRef.current.features);
    // 新铺位不继承任何属性：位号留空（界面显示"未编号"），由后续编辑补录
    const feature = createShopFeature(result, {
      uid,
      code: "",
      merchantNo: "",
      merchantName: "",
    });

    dispatch({
      type: "commit",
      shops: {
        type: "FeatureCollection",
        features: [...shopsRef.current.features, feature],
      },
      // 新铺位自动选中，方便立刻继续裁切/合并
      selection: [uid],
    });
    message.success("已新增 1 个铺位");
  };

  // 沿线一分为二：起止点都必须落在所选铺位的边界上（容差 0.1m），
  // 否则几何上切不开，直接提示而不是生成奇怪的结果
  const applyLineCut = (start, end) => {
    const selected = new Set(selectionRef.current);
    if (!selected.size) {
      message.warning("请先在“选择”模式下选中要切割的铺位");
      return;
    }

    const targets = shopsRef.current.features.filter((feature) =>
      selected.has(feature.properties.uid),
    );
    const boundaries = targets.flatMap((feature) =>
      geometryToPolygons(feature.geometry),
    );
    if (
      !pointOnBoundary(start, boundaries) ||
      !pointOnBoundary(end, boundaries)
    ) {
      message.warning("线段的起止点必须落在所选铺位的边缘上");
      return;
    }

    const uidPool = [...shopsRef.current.features];
    const nextFeatures = [];
    const nextSelection = [];
    let splitCount = 0;

    for (const feature of shopsRef.current.features) {
      if (!selected.has(feature.properties.uid)) {
        nextFeatures.push(feature);
        continue;
      }

      // 返回两半；线没有真正穿过该铺位时返回 null，保持原样
      const halves = splitPolygonsByLine(
        geometryToPolygons(feature.geometry),
        start,
        end,
      );
      if (!halves) {
        nextFeatures.push(feature);
        continue;
      }

      // 用原标注点判断哪一半"继承"原铺位：位号留在标注点所在的那半，
      // 另一半作为新铺位（空位号、空商户），保证原来的位号不会凭空换位置
      const keepUid = feature.properties.uid;
      const label = labelPoint(feature.geometry);
      const keep = pointInPolygons(label, halves[0]) ? halves[0] : halves[1];
      const created = keep === halves[0] ? halves[1] : halves[0];

      nextFeatures.push(updateShopGeometry(feature, keep));
      // uidPool 逐次追加，保证同一批里生成的新 uid 不重复
      const part = createShopFeature(created, {
        uid: nextShopUid(uidPool),
        ...derivedPartProps(feature.properties),
      });
      uidPool.push(part);
      nextFeatures.push(part);
      // 切完两半都选中，方便继续操作
      nextSelection.push(keepUid, part.properties.uid);
      splitCount += 1;
    }

    if (!splitCount) {
      message.warning("切割线未穿过任何所选铺位，未进行切割");
      return;
    }

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: nextSelection,
    });
    message.success(`已将 ${splitCount} 个铺位一分为二`);
  };

  // 合并：求并集后写回选中的第一间（按铺位数组顺序，不一定是先点的那间），
  // 保留它的 uid 和位号，其余选中项删除
  const handleMerge = () => {
    const selected = new Set(selectionRef.current);
    const picked = shopsRef.current.features.filter((feature) =>
      selected.has(feature.properties.uid),
    );
    if (picked.length < 2) {
      message.warning("请至少选择 2 个铺位再合并");
      return;
    }

    const merged = cleanPolygons(
      unionPolygons(
        picked.flatMap((feature) => geometryToPolygons(feature.geometry)),
      ),
    );
    if (!merged.length) {
      message.error("合并失败：结果为空");
      return;
    }

    const keepUid = picked[0].properties.uid;
    const nextFeatures = [];
    for (const feature of shopsRef.current.features) {
      const uid = feature.properties.uid;
      // 未选中的原样保留；合并结果只落到 keepUid 上，其余选中项直接消失
      if (!selected.has(uid)) nextFeatures.push(feature);
      else if (uid === keepUid)
        nextFeatures.push(updateShopGeometry(feature, merged));
    }

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [keepUid],
    });
    message.success(
      `已合并 ${picked.length} 个铺位，保留 ${picked[0].properties.label}`,
    );
  };

  // 拆分只针对"一片铺位由多个不相连部分组成"（MultiPolygon 多片）的情况：
  // 第一片保留原 uid/位号，其余每片变成一个新铺位
  const handleSplit = () => {
    const selected = new Set(selectionRef.current);
    const targets = shopsRef.current.features.filter(
      (feature) =>
        selected.has(feature.properties.uid) &&
        geometryToPolygons(feature.geometry).length > 1,
    );
    if (!targets.length) {
      message.warning("请选择至少 1 个由多个部分组成的铺位再拆分");
      return;
    }

    const targetUids = new Set(
      targets.map((feature) => feature.properties.uid),
    );
    const uidPool = [...shopsRef.current.features];
    const nextFeatures = [];
    const nextSelection = [];
    let totalParts = 0;

    for (const feature of shopsRef.current.features) {
      if (!targetUids.has(feature.properties.uid)) {
        nextFeatures.push(feature);
        continue;
      }

      const polygons = geometryToPolygons(feature.geometry);
      polygons.forEach((polygon, index) => {
        totalParts += 1;
        // 下标 0 的那片保持原要素（uid、位号不变），其余片生成新铺位
        if (index === 0) {
          nextFeatures.push(updateShopGeometry(feature, [polygon]));
          nextSelection.push(feature.properties.uid);
          return;
        }

        const part = createShopFeature([polygon], {
          uid: nextShopUid(uidPool),
          ...derivedPartProps(feature.properties),
        });
        uidPool.push(part);
        nextFeatures.push(part);
        nextSelection.push(part.properties.uid);
      });
    }

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: nextSelection,
    });
    message.success(
      `已将 ${targets.length} 个铺位拆分为 ${totalParts} 个铺位`,
    );
  };

  // 删除：直接过滤掉所选 uid，清空选区；仍可通过撤销恢复
  const handleDelete = () => {
    const selected = new Set(selectionRef.current);
    const nextFeatures = shopsRef.current.features.filter(
      (feature) => !selected.has(feature.properties.uid),
    );
    const removed = shopsRef.current.features.length - nextFeatures.length;

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [],
    });
    message.success(`已删除 ${removed} 个铺位`);
  };

  return {
    applyCrop,
    applyAdd,
    applyLineCut,
    handleMerge,
    handleSplit,
    handleDelete,
  };
}
