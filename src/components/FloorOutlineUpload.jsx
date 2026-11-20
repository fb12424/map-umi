import { useState } from "react";
import { Alert, Button, Upload, message } from "antd";
import { normalizeOutlineGeoJson } from "../lib/floorGeometry.js";

const { Dragger } = Upload;

async function parseFile(file) {
  if (!/\.(geojson|json)$/i.test(file.name)) {
    throw new Error("请选择 .geojson 或 .json 文件");
  }

  const text = (await file.text()).replace(/^\uFEFF/, "");
  const raw = JSON.parse(text);
  const { geojson, polygonCount } = normalizeOutlineGeoJson(raw);

  return {
    fileName: file.name,
    fileSize: file.size,
    polygonCount,
    geojson,
    source: "upload",
  };
}

export default function FloorOutlineUpload({ value, onChange }) {
  const [parsing, setParsing] = useState(false);

  const handleFile = async (info) => {
    const file = info.file?.originFileObj ?? info.file;
    if (!file) return;

    setParsing(true);
    try {
      const parsed = await parseFile(file);
      onChange(parsed);
      message.success(`已解析楼板轮廓（${parsed.polygonCount} 个面）`);
    } catch (error) {
      message.error(`轮廓 GeoJSON 解析失败：${error.message}`);
    } finally {
      setParsing(false);
    }
  };

  return (
    <>
      <Dragger
        accept=".geojson,.json,application/geo+json,application/json"
        maxCount={1}
        multiple={false}
        showUploadList={false}
        beforeUpload={() => false}
        onChange={handleFile}
        disabled={parsing}
      >
        <p className="ant-upload-text">
          {parsing ? "正在解析轮廓…" : "点击或拖拽轮廓 GeoJSON 到此处"}
        </p>
      </Dragger>

      {value && (
        <Alert
          type="success"
          showIcon
          message={value.source === "saved" ? "已加载已保存轮廓" : "轮廓已解析"}
          description={`${value.fileName}${
            value.fileSize
              ? `（${(value.fileSize / 1024).toFixed(1)} KB）`
              : ""
          } · ${value.polygonCount} 个面`}
          style={{ marginTop: 16 }}
          action={
            <Button size="small" onClick={() => onChange(null)}>
              改为自动计算
            </Button>
          }
        />
      )}
    </>
  );
}
