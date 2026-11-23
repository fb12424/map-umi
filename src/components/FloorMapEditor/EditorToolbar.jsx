import { UndoOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Segmented, Space } from "antd";

// 纯展示工具栏：按钮状态完全由 props 推导，所有动作通过回调上抛，
// 不含任何编辑逻辑，方便单独调整布局与文案
export default function EditorToolbar({
  tool,
  shape,
  selectionCount,
  pastLength,
  splittableCount,
  onUndo,
  onToolChange,
  onShapeChange,
  onMerge,
  onSplit,
  onDelete,
  onCancel,
  onApply,
}) {
  return (
    <div className="editor-toolbar">
      {/* 第一行：撤销、编辑模式切换、整体取消/应用 */}
      <div className="editor-toolbar-row">
        <Button
          size="small"
          icon={<UndoOutlined />}
          title="撤销上一步"
          disabled={!pastLength}
          onClick={onUndo}
        >
          撤销
        </Button>
        <span className="editor-toolbar-divider" />

        <span className="editor-toolbar-label">编辑模式</span>
        <Button
          type={tool === "select" ? "primary" : "default"}
          onClick={() => onToolChange("select")}
        >
          选择铺位
        </Button>
        <Button
          type={tool === "add" ? "primary" : "default"}
          onClick={() => onToolChange("add")}
        >
          新增铺位
        </Button>

        <Space size={8} className="editor-toolbar-actions">
          <Button size="small" onClick={onCancel}>
            取消
          </Button>
          <Button size="small" type="primary" onClick={onApply}>
            应用修改
          </Button>
        </Space>
      </div>

      {/* 第二行：对选区生效的操作，disabled 条件即各操作的最低要求 */}
      <div className="editor-toolbar-row editor-toolbar-secondary">
        <span className="editor-toolbar-label">铺位操作</span>
        <Button
          size="small"
          disabled={!selectionCount}
          className={tool === "crop" ? "editor-tool-active" : ""}
          onClick={() => onToolChange("crop")}
        >
          裁切所选
        </Button>
        <Button size="small" disabled={selectionCount < 2} onClick={onMerge}>
          合并所选
        </Button>
        <Button
          size="small"
          disabled={!splittableCount}
          title="将选中铺位的每个独立部分拆成单独铺位，铺位号保留在第一个"
          onClick={onSplit}
        >
          拆分所选{splittableCount ? `（${splittableCount}）` : ""}
        </Button>
        {/* 删除会一次移除多个铺位且容易误点，用 Popconfirm 做二次确认 */}
        {selectionCount ? (
          <Popconfirm
            title={`删除选中的 ${selectionCount} 个铺位？`}
            okText="删除"
            cancelText="取消"
            placement="bottom"
            onConfirm={onDelete}
          >
            <Button size="small" danger>
              删除所选
            </Button>
          </Popconfirm>
        ) : (
          <Button size="small" danger disabled>
            删除所选
          </Button>
        )}
      </div>
      {/* 第三行：绘制形状；线段仅裁切模式提供，新增铺位不需要线段 */}
      {tool !== "select" && (
        <div className="editor-toolbar-row editor-toolbar-secondary">
          <Segmented
            size="small"
            value={shape}
            onChange={onShapeChange}
            options={[
              ...(tool === "crop" ? [{ label: "线段", value: "line" }] : []),
              { label: "矩形", value: "rect" },
              { label: "椭圆", value: "ellipse" },
              { label: "多边形", value: "polygon" },
            ]}
          />
        </div>
      )}
    </div>
  );
}

