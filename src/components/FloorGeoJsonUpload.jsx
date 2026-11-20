import { useState } from "react";
import { Alert, Upload, message } from "antd";
import { assertWgs84, normalizeShopData } from "../lib/shopGeometry.js";

const { Dragger } = Upload;

async function parseFile(file) {
  if (!/\.(geojson|json)$/i.test(file.name)) {
    throw new Error("请选择 .geojson 或 .json 文件");
  }

  const text = (await file.text()).replace(/^\uFEFF/, "");
  const raw = JSON.parse(text);
  if (raw?.type !== "FeatureCollection" || !Array.isArray(raw.features)) {
    throw new Error("顶层必须是 FeatureCollection");
  }

  const shops = normalizeShopData(raw);
  if (!shops.features.length) {
    throw new Error("没有可用的 Polygon / MultiPolygon 铺位面");
  }
  assertWgs84(shops.features);

  return {
    fileName: file.name,
    fileSize: file.size,
    raw,
    shops,
  };
}

export default function FloorGeoJsonUpload({ value, onChange }) {
  const [parsing, setParsing] = useState(false);

  const handleFile = async (info) => {
    const file = info.file?.originFileObj ?? info.file;
    if (!file) return;

    setParsing(true);
    try {
      const parsed = await parseFile(file);
      onChange(parsed);
      message.success(`已解析 ${parsed.shops.features.length} 个铺位面`);
    } catch (error) {
      onChange(null);
      message.error(`GeoJSON 解析失败：${error.message}`);
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
          {parsing ? "正在解析 GeoJSON…" : "点击或拖拽 GeoJSON 文件到此处"}
        </p>
      </Dragger>

      {value && (
        <Alert
          type="success"
          showIcon
          message="GeoJSON 已解析"
          description={`${value.fileName}（${(value.fileSize / 1024).toFixed(1)} KB）· ${
            value.shops.features.length
          } 个铺位面`}
          style={{ marginTop: 16 }}
        />
      )}
    </>
  );
}
