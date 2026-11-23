// 铺位手动编辑器（全屏覆盖层），三层分工：
// - 本文件：用 useReducer 持有铺位集合/选区/撤销栈，拼装工具栏、统计与提示
// - useEditorMap：MapLibre 生命周期、草稿绘制、吸附与键鼠交互
// - useShopOperations：裁切/新增/切割/合并/拆分/删除等几何运算
// 编辑只改本地副本，点"应用修改"时才通过 onApply 把结果交还父页面
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
  // dataset 形如 { raw, shops, unitCount }：raw 是上传/已保存的原始 GeoJSON，
  // shops 是规整后的铺位集合（保证 MultiPolygon、uid、位号等字段齐全）
  dataset,
  floorGeojson,
  onCancel,
  onApply,
}) {
  // 以 dataset.shops 为初始快照；父页面的 dataset 全程不动，
  // 所以"取消"只需直接关闭，编辑结果自然丢弃
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
  // 楼板轮廓：优先用上传的轮廓，没有则由铺位并集异步派生（见下方 effect）
  const [floor, setFloor] = useState(floorGeojson ?? null);

  const ops = useShopOperations({ dispatch, shops, selection });

  // 地图 Hook 只负责"画完/点完"，具体执行哪种图元操作由这里按工具分发
  const finishShape = (polygon) => {
    if (tool === "crop") ops.applyCrop(polygon);
    else if (tool === "add") ops.applyAdd(polygon);
  };

  const finishLine = (start, end) => {
    if (tool === "crop") {
      ops.applyLineCut([start.lng, start.lat], [end.lng, end.lat]);
    }
  };

  // 点击铺位切换选中；uid 为空表示点到空白处，清空选择
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

  // 交互结果通过回调回到 React：《useEditorMap》里这些回调都存进 ref，
  // 因此父组件重渲染不会导致地图事件重新绑定
  const { containerRef, drawing, clearDraft } = useEditorMap({
    shops,
    selection,
    tool,
    shape,
    floor,
    onFinishShape: finishShape,
    onFinishLine: finishLine,
    onPick: pick,
    onSwitchToSelect: switchToSelect,
    onClearSelection: clearSelection,
  });

  const handleToolChange = (next) => {
    if (next === "add") {
      // 新增不针对已选铺位，保留选区会让后续操作对象产生歧义；
      // 线段形状只在裁切时有效，切到新增时回退成矩形
      dispatch({
        type: "select",
        selection: [],
      });
      if (shape === "line") setShape("rect");
    }
    // 先清掉上一个工具画了一半的草稿，再切工具
    clearDraft();
    setTool(next);
  };

  const handleShapeChange = (next) => {
    clearDraft();
    setShape(next);
  };

  // 空结果不允许应用，避免把"误删全部"当成正常保存；这种情况应撤销或取消
  const handleApply = () => {
    if (!shops.features.length) {
      message.warning("编辑结果没有铺位，请撤销或取消");
      return;
    }
    // buildEditedDataset 把编辑结果合并回原始 raw：保留非铺位要素，
    // 未改动的铺位沿用原始几何（保精度），已删除的铺位从 raw 中移除
    onApply(buildEditedDataset(dataset, shops));
  };

  // 没有上传楼板轮廓时，按铺位并集派生一个（外扩黏连 → 内缩 → 加墙边距）。
  // 放到 setTimeout 0 里异步执行，避免大计算阻塞编辑器的首屏渲染
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

  // 只有由多个不相连部分组成（MultiPolygon 多片）的选中铺位才可拆分
  const selectedUidSet = new Set(selection);
  const splittableCount = shops.features.filter(
    (feature) =>
      selectedUidSet.has(feature.properties.uid) &&
      geometryToPolygons(feature.geometry).length > 1,
  ).length;

  // 底部提示常驻显示，按"正在绘制 → 当前工具 → 默认"三档切换
  const hint = drawing
    ? shape === "polygon"
      ? "双击或回车闭合多边形 · Backspace 撤销上一点 · Esc 取消"
      : "点击第二点完成切割线 · Backspace 撤销起点 · Esc 取消"
    : tool === "select"
    ? "点击铺位选中或取消，可多选；点击空白处清空选择。"
    : tool === "crop"
    ? selection.length
      ? shape === "line"
        ? "依次点击铺位边缘上的两个点绘制切割线，将所选铺位一分为二。"
        : "拖拽矩形/椭圆、依次点击绘制多边形或线段；圈中部分将被裁掉，线段可将铺位一分为二。"
      : "请先在“选择”模式下选中要裁切的铺位。"
    : "拖拽矩形/椭圆或依次点击绘制多边形，生成新铺位；与已有铺位重叠的部分会自动扣除。";

  return (
    <div className="editor-overlay">
      <div className="editor-map">
        {/* MapLibre 的 canvas 由 useEditorMap 挂到这个容器里，CSS 用 absolute 铺满 */}
        <div ref={containerRef} className="editor-map-canvas" />

        {/* 左上角悬浮区：工具栏 + 铺位/已选统计，宽度受视口限制，窄屏时自动换行 */}
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

        {/* 底部操作提示常驻显示；pointer-events 在 CSS 里关掉，不会挡住绘制 */}
        <div className="editor-hint">{hint}</div>
      </div>
    </div>
  );
}
