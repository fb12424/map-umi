import { useEffect, useReducer, useState } from "react";
import { message } from "antd";
import { deriveFloorFromShops } from "../../lib/floorGeometry.js";
import {
  buildEditedDataset,
  geometryToPolygons,
} from "../../lib/polygonOps.js";
import EditorToolbar from "./EditorToolbar.jsx";
import { editorReducer } from "./editorCore.js";
import useEditorMap from "./useEditorMap.js";
import useShopOperations from "./useShopOperations.js";
import "./FloorMapEditor.css";

export default function FloorMapEditor({
  dataset,
  floorGeojson,
  onCancel,
  onApply,
}) {
  const [state, dispatch] = useReducer(
    editorReducer,
    dataset.shops,
    (shops) => ({
      shops,
      selection: [],
      past: [],
    }),
  );
  const { shops, selection, past } = state;

  const [tool, setTool] = useState("select");
  const [shape, setShape] = useState("rect");
  const [floor, setFloor] = useState(floorGeojson ?? null);

  const ops = useShopOperations({ dispatch, shops, selection });

  const finishShape = (polygon) => {
    if (tool === "crop") ops.applyCrop(polygon);
    else if (tool === "add") ops.applyAdd(polygon);
  };

  const pick = (uid) => {
    const current = selection;
    const next = uid
      ? current.includes(uid)
        ? current.filter((item) => item !== uid)
        : [...current, uid]
      : [];
    dispatch({ type: "select", selection: next });
  };

  const switchToSelect = () => setTool("select");
  const clearSelection = () => dispatch({ type: "select", selection: [] });

  const { containerRef, drawing, clearDraft } = useEditorMap({
    shops,
    selection,
    tool,
    shape,
    floor,
    onFinishShape: finishShape,
    onPick: pick,
    onSwitchToSelect: switchToSelect,
    onClearSelection: clearSelection,
  });

  const handleToolChange = (next) => {
    if (next === "add") {
      dispatch({
        type: "select",
        selection: [],
      });
    }
    clearDraft();
    setTool(next);
  };

  const handleShapeChange = (next) => {
    clearDraft();
    setShape(next);
  };

  const handleApply = () => {
    if (!shops.features.length) {
      message.warning("编辑结果没有铺位，请撤销或取消");
      return;
    }
    onApply(buildEditedDataset(dataset, shops));
  };

  useEffect(() => {
    if (floor || !dataset.shops.features.length) return undefined;

    const timer = setTimeout(() => {
      try {
        setFloor(deriveFloorFromShops(dataset.shops.features));
      } catch (error) {
        console.warn("楼板派生失败，仅显示商铺", error);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [floor, dataset]);

  const selectedUidSet = new Set(selection);
  const splittableCount = shops.features.filter(
    (feature) =>
      selectedUidSet.has(feature.properties.uid) &&
      geometryToPolygons(feature.geometry).length > 1,
  ).length;

  const hint = drawing
    ? "双击或回车闭合多边形 · Backspace 撤销上一点 · Esc 取消"
    : tool === "select"
    ? "点击铺位选中或取消，可多选；点击空白处清空选择。"
    : tool === "crop"
    ? selection.length
      ? "拖拽矩形/椭圆或依次点击绘制多边形，圈中部分将从所选铺位中裁掉。"
      : "请先在“选择”模式下选中要裁切的铺位。"
    : "拖拽矩形/椭圆或依次点击绘制多边形，生成新铺位；与已有铺位重叠的部分会自动扣除。";

  return (
    <div className="editor-overlay">
      <div className="editor-map">
        <div ref={containerRef} className="editor-map-canvas" />

        <div className="editor-corner">
          <EditorToolbar
            tool={tool}
            shape={shape}
            selectionCount={selection.length}
            pastLength={past.length}
            splittableCount={splittableCount}
            onUndo={() => dispatch({ type: "undo" })}
            onToolChange={handleToolChange}
            onShapeChange={handleShapeChange}
            onMerge={ops.handleMerge}
            onSplit={ops.handleSplit}
            onDelete={ops.handleDelete}
            onCancel={onCancel}
            onApply={handleApply}
          />
          <div className="editor-summary">
            <div className="editor-summary-item">
              <span className="editor-summary-label">铺位</span>
              <span className="editor-summary-value">
                {shops.features.length}
              </span>
            </div>
            <span className="editor-summary-divider" />
            <div className="editor-summary-item">
              <span className="editor-summary-label">已选</span>
              <span
                className={
                  selection.length
                    ? "editor-summary-value is-active"
                    : "editor-summary-value"
                }
              >
                {selection.length}
              </span>
            </div>
          </div>
        </div>

        <div className="editor-hint">{hint}</div>
      </div>
    </div>
  );
}
