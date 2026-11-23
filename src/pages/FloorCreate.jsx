import { useEffect, useMemo, useState } from "react";
import {
  Alert,
  Button,
  Card,
  Col,
  Divider,
  Empty,
  Form,
  Input,
  InputNumber,
  Row,
  Space,
  message,
} from "antd";
import { history, useParams } from "umi";
import FloorGeoJsonCompare from "../components/FloorGeoJsonCompare.jsx";
import FloorGeoJsonUpload from "../components/FloorGeoJsonUpload.jsx";
import FloorMapEditor from "../components/FloorMapEditor/index.jsx";
import FloorEditPreview from "../components/FloorEditPreview/index.jsx";
import FloorMerchantUpdate from "../components/FloorMerchantUpdate.jsx";
import FloorOutlineUpload from "../components/FloorOutlineUpload.jsx";
import {
  deriveFloorFromShops,
  normalizeOutlineGeoJson,
} from "../lib/floorGeometry.js";
import { findDuplicateCodes, normalizeShopData } from "../lib/shopGeometry.js";
import {
  createMap,
  getMap,
  getMapGeoJson,
  getMapOutline,
  updateMap,
} from "../services/maps.js";

function savedOutlineValue(raw) {
  if (!raw) return null;
  try {
    const { geojson, polygonCount } = normalizeOutlineGeoJson(raw);
    return {
      fileName: "已保存轮廓",
      fileSize: null,
      polygonCount,
      geojson,
      source: "saved",
    };
  } catch (error) {
    console.warn("已保存轮廓解析失败", error);
    return null;
  }
}

export default function FloorCreate() {
  const { floorId } = useParams();
  const [form] = Form.useForm();
  const [upload, setUpload] = useState(null);
  const [uploadApplied, setUploadApplied] = useState(false);
  const [compareOpen, setCompareOpen] = useState(false);
  const [saved, setSaved] = useState(null);
  const [loading, setLoading] = useState(false);
  const [mapVersion, setMapVersion] = useState(0);
  const [editing, setEditing] = useState(null);
  const [floorGeojson, setFloorGeojson] = useState(null);
  const [submitting, setSubmitting] = useState(false);
  const [linkedUid, setLinkedUid] = useState(null);
  const [editorOpen, setEditorOpen] = useState(false);
  const [outlineUpload, setOutlineUpload] = useState(null);

  const isEdit = !!floorId;
  const dataset = isEdit ? upload ?? saved : upload;
  const shops = dataset?.shops ?? null;
  const duplicateCodes = useMemo(
    () => (shops ? findDuplicateCodes(shops.features) : []),
    [shops],
  );
  const hasDuplicateCodes = duplicateCodes.length > 0;
  const duplicateText =
    duplicateCodes.length > 8
      ? `${duplicateCodes.slice(0, 8).join("、")} 等 ${
          duplicateCodes.length
        } 个`
      : duplicateCodes.join("、");

  const canEditManually =
    Boolean(dataset?.raw && shops) &&
    !compareOpen &&
    !submitting &&
    !(isEdit && upload && !uploadApplied);

  useEffect(() => {
    form.resetFields();
    setUpload(null);
    setUploadApplied(false);
    setCompareOpen(false);
    setLinkedUid(null);
    setSaved(null);
    setEditing(null);
    setFloorGeojson(null);
    setEditorOpen(false);
    setOutlineUpload(null);
    setMapVersion((version) => version + 1);

    if (!floorId) return undefined;

    let active = true;
    setLoading(true);

    Promise.all([
      getMap(floorId),
      getMapGeoJson(floorId),
      getMapOutline(floorId).catch(() => null),
    ])
      .then(([map, geojson, outline]) => {
        if (!active) return;
        form.setFieldsValue({
          code: map.floorCode,
          name: map.name,
          shopCount: map.unitCount,
        });
        setSaved({
          raw: geojson,
          shops: normalizeShopData(geojson),
          unitCount: map.unitCount,
        });
        setOutlineUpload(savedOutlineValue(outline));
        setMapVersion((version) => version + 1);
      })
      .catch((error) => {
        if (active) message.error(error.message || "楼层加载失败");
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [floorId]);

  const handleUploadChange = (parsed) => {
    if (!parsed && isEdit) return;

    setUpload(parsed);
    setUploadApplied(!isEdit);
    setCompareOpen(false);
    setLinkedUid(null);
    setEditing(null);
    setFloorGeojson(null);
    setMapVersion((version) => version + 1);
    if (parsed) {
      form.setFieldValue("shopCount", parsed.shops.features.length);
    }
  };

  const handleDiscardUpload = () => {
    setUpload(null);
    setUploadApplied(false);
    setCompareOpen(false);
    setLinkedUid(null);
    setEditing(null);
    setFloorGeojson(null);
    setMapVersion((version) => version + 1);
    form.setFieldValue("shopCount", saved?.unitCount);
  };

  const handleCompareConfirm = (merged) => {
    setUpload(merged);
    setUploadApplied(true);
    setCompareOpen(false);
    setLinkedUid(null);
    setEditing(null);
    form.setFieldValue("shopCount", merged.shops.features.length);
  };

  const handleEditorApply = (nextDataset) => {
    if (isEdit && !upload) setSaved(nextDataset);
    else setUpload(nextDataset);

    setUploadApplied(true);
    setLinkedUid(null);
    setEditing(null);
    form.setFieldValue("shopCount", nextDataset.shops.features.length);
    setEditorOpen(false);
  };

  const handleShopClick = (shop) => {
    setEditing(shop);
  };

  const handleEditSave = (values) => {
    if (!editing) return;

    const nextCode = values.code.trim();
    const merchantNo = (values.merchantNo || "").trim();
    const merchantName = (values.merchantName || "").trim();

    const update = (prev) => {
      if (!prev) return prev;

      return {
        ...prev,
        shops: {
          ...prev.shops,
          features: prev.shops.features.map((feature) =>
            feature.properties.uid === editing.uid
              ? {
                  ...feature,
                  properties: {
                    ...feature.properties,
                    code: nextCode,
                    label: nextCode || "未编号",
                    merchantNo,
                    merchantName,
                  },
                }
              : feature,
          ),
        },
        raw: {
          ...prev.raw,
          features: prev.raw.features.map((feature) =>
            feature.properties?.uid === editing.uid
              ? {
                  ...feature,
                  properties: {
                    ...feature.properties,
                    code: nextCode,
                    merchantNo,
                    merchantName,
                  },
                }
              : feature,
          ),
        },
      };
    };

    if (isEdit && !upload) setSaved(update);
    else setUpload(update);

    message.success(`已更新铺位 ${nextCode} 的信息`);
    setEditing(null);
  };

  const openCompare = () => {
    if (hasDuplicateCodes) {
      message.error(`存在重复铺位号：${duplicateText}，请先修正后再比对`);
      return;
    }
    setCompareOpen(true);
  };

  const handleSubmit = async (values) => {
    const base = {
      floorCode: values.code.trim(),
      name: values.name.trim(),
      unitCount: values.shopCount ?? (shops ? shops.features.length : 0),
    };

    if (!isEdit && !upload) {
      message.warning("请先上传 GeoJSON 文件");
      return;
    }

    if (hasDuplicateCodes) {
      message.error(`存在重复铺位号：${duplicateText}，请先修正后再提交`);
      return;
    }

    if (isEdit && upload && !uploadApplied) {
      message.info("请先完成新地图与旧商户信息的比对");
      setCompareOpen(true);
      return;
    }

    setSubmitting(true);
    // 先让 loading 状态渲染，再同步重算楼板轮廓
    await new Promise((resolve) => setTimeout(resolve, 0));
    try {
      let outline = outlineUpload?.geojson ?? floorGeojson;
      if (!outlineUpload) {
        try {
          if (shops?.features?.length) {
            outline = deriveFloorFromShops(shops.features);
          }
        } catch (error) {
          console.warn("楼板轮廓重算失败，沿用预览轮廓", error);
        }
      }

      if (isEdit) {
        const geojson = upload?.raw ?? saved?.raw;
        await updateMap(floorId, {
          ...base,
          ...(geojson ? { geojson } : {}),
          ...(outline ? { outline } : {}),
        });
        message.success(`楼层 ${base.floorCode} 已更新`);
      } else {
        const created = await createMap({
          ...base,
          geojson: upload.raw,
          ...(outline ? { outline } : {}),
        });
        message.success(`楼层 ${created.floorCode} 已创建`);
      }
      history.push("/floors");
    } catch (error) {
      message.error(error.message || "提交失败");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="page-stack create-page">
      <Row className="create-layout" gutter={[16, 16]} align="stretch">
        <Col xs={24} lg={6}>
          <Card title="楼层信息">
            <FloorGeoJsonUpload value={upload} onChange={handleUploadChange} />

            {isEdit && upload && (
              <Alert
                style={{ marginTop: 16 }}
                type={uploadApplied ? "success" : "warning"}
                showIcon
                message={
                  uploadApplied ? "新地图已应用，保存后生效" : "新地图待比对"
                }
                description={`${upload.fileName} · ${upload.shops.features.length} 个铺位面`}
                action={
                  <Space direction="vertical" size={4}>
                    <Button
                      size="small"
                      type="primary"
                      disabled={hasDuplicateCodes}
                      onClick={openCompare}
                    >
                      {uploadApplied ? "重新比对" : "比对并应用"}
                    </Button>
                    <Button size="small" onClick={handleDiscardUpload}>
                      放弃
                    </Button>
                  </Space>
                }
              />
            )}

            {hasDuplicateCodes && (
              <Alert
                style={{ marginTop: 16 }}
                type="error"
                showIcon
                message="铺位号重复，暂不能提交或比对"
                description={`重复铺位号：${duplicateText}。请点击地图中红色标记的铺位修改铺位号，处理完重复后再继续。`}
              />
            )}

            <Divider
              orientation="left"
              plain
              style={{ margin: "24px 0 16px" }}
            >
              楼板轮廓（可选）
            </Divider>
            <FloorOutlineUpload
              value={outlineUpload}
              onChange={setOutlineUpload}
            />

            <Form
              form={form}
              layout="vertical"
              onFinish={handleSubmit}
              style={{ marginTop: 24 }}
            >
              <Row gutter={16}>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="code"
                    label="楼层编号"
                    rules={[{ required: true, message: "请输入楼层编号" }]}
                  >
                    <Input placeholder="如 1F、B1" disabled={isEdit} />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item
                    name="name"
                    label="楼层名称"
                    rules={[{ required: true, message: "请输入楼层名称" }]}
                  >
                    <Input placeholder="如 一层" />
                  </Form.Item>
                </Col>
                <Col xs={24} sm={12}>
                  <Form.Item name="shopCount" label="商铺个数">
                    <InputNumber
                      min={0}
                      precision={0}
                      style={{ width: "100%" }}
                    />
                  </Form.Item>
                </Col>
              </Row>

              <Space>
                <Button
                  type="primary"
                  htmlType="submit"
                  loading={submitting}
                  disabled={hasDuplicateCodes}
                >
                  {isEdit ? "保存" : "提交"}
                </Button>
                <Button
                  htmlType="button"
                  disabled={submitting}
                  onClick={() => history.push("/floors")}
                >
                  取消
                </Button>
              </Space>
            </Form>
          </Card>
        </Col>

        <Col xs={24} lg={18}>
          <Card
            title="楼层地图预览"
            className="preview-card"
            extra={
              <Space>
                <Button
                  type="primary"
                  disabled={!canEditManually}
                  onClick={() => setEditorOpen(true)}
                >
                  手动编辑地图
                </Button>
                <Button type="link" onClick={() => history.push("/floors")}>
                  返回列表
                </Button>
              </Space>
            }
          >
            {shops ? (
              <FloorEditPreview
                geojson={shops}
                floor={outlineUpload?.geojson ?? null}
                fitKey={mapVersion}
                activeUid={editing?.uid ?? null}
                linkedUid={compareOpen ? linkedUid : null}
                showUnnumberedIndex={compareOpen}
                onShopClick={compareOpen ? undefined : handleShopClick}
                onFloorReady={setFloorGeojson}
              />
            ) : (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description={
                  isEdit
                    ? loading
                      ? "正在加载楼层地图…"
                      : "该楼层暂无地图数据"
                    : "上传 GeoJSON 后在此预览楼层地图"
                }
                style={{
                  padding: "48px 0",
                  flex: 1,
                  display: "flex",
                  flexDirection: "column",
                  justifyContent: "center",
                }}
              />
            )}
          </Card>
        </Col>
      </Row>

      <FloorMerchantUpdate
        shops={shops}
        editing={editing}
        open={Boolean(editing)}
        onClose={() => setEditing(null)}
        onSuccess={handleEditSave}
        onCancel={() => setEditing(null)}
      />

      {isEdit && (
        <FloorGeoJsonCompare
          open={compareOpen}
          oldShops={saved?.shops}
          newData={upload}
          onCancel={() => {
            setCompareOpen(false);
            setLinkedUid(null);
          }}
          onConfirm={handleCompareConfirm}
          onHoverTarget={setLinkedUid}
        />
      )}

      {editorOpen && dataset?.raw && (
        <FloorMapEditor
          dataset={dataset}
          floorGeojson={outlineUpload?.geojson ?? floorGeojson}
          onCancel={() => setEditorOpen(false)}
          onApply={handleEditorApply}
        />
      )}
    </div>
  );
}

