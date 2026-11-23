import { UndoOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Segmented, Space } from "antd";

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
        <Button
          size="small"
          disabled={selectionCount < 2}
          onClick={onMerge}
        >
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
      {tool !== "select" && (
        <div className="editor-toolbar-row editor-toolbar-secondary">
          <Segmented
            size="small"
            value={shape}
            onChange={onShapeChange}
            options={[
              ...(tool === "crop"
                ? [{ label: "线段", value: "line" }]
                : []),
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
