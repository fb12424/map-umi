import { useEffect, useRef } from "react";
import { message } from "antd";
import {
  areaChanged,
  cleanPolygons,
  createShopFeature,
  geometryToPolygons,
  nextShopUid,
  polygonsAreaM2,
  subtractPolygons,
  unionPolygons,
  updateShopGeometry,
} from "../../lib/polygonOps.js";
import { ADD_MIN_FREE_M2, ADD_MIN_FREE_RATIO } from "./editorCore.js";

export default function useShopOperations({ dispatch, shops, selection }) {
  const shopsRef = useRef(shops);
  const selectionRef = useRef(selection);
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
    const polygons = unionPolygons(
      shopsRef.current.features.flatMap((feature) =>
        geometryToPolygons(feature.geometry),
      ),
    );
    occupiedRef.current = { shops: shopsRef.current, polygons };
    return polygons;
  };

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

      if (!result.length) {
        changed += 1;
        removed += 1;
        continue;
      }

      const afterArea = polygonsAreaM2(result);
      if (!areaChanged(beforeArea, afterArea)) {
        nextFeatures.push(feature);
        continue;
      }

      nextFeatures.push(updateShopGeometry(feature, result));
      changed += 1;
    }

    if (!changed) {
      message.info("所选铺位与圈选区域没有重叠");
      return;
    }

    const uids = new Set(nextFeatures.map((feature) => feature.properties.uid));
    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [...selected].filter((uid) => uids.has(uid)),
    });
    message.success(
      `已裁切 ${changed} 个铺位${removed ? `，${removed} 个被完全移除` : ""}`,
    );
  };

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
      selection: [uid],
    });
    message.success("已新增 1 个铺位");
  };

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
        if (index === 0) {
          nextFeatures.push(updateShopGeometry(feature, [polygon]));
          nextSelection.push(feature.properties.uid);
          return;
        }

        const part = createShopFeature([polygon], {
          uid: nextShopUid(uidPool),
          code: "",
          merchantNo: "",
          merchantName: "",
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

  return { applyCrop, applyAdd, handleMerge, handleSplit, handleDelete };
}
