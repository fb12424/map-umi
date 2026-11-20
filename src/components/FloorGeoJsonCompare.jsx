import { useEffect, useMemo, useState } from "react";
import { Alert, Button, Drawer, Select, Space, Table, Tag, Typography } from "antd";
import { findDuplicateCodes } from "../lib/shopGeometry.js";

const { Text } = Typography;

const text = (value) => (typeof value === "string" ? value.trim() : "");
const codeOf = (feature) => feature.properties.code || "未编号";
const optionText = (feature, ordinalByUid) => {
  if (text(feature.properties.code)) return codeOf(feature);
  const ordinal = ordinalByUid.get(feature.properties.uid);
  return ordinal ? `未编号 #${ordinal}` : "未编号";
};
const merchantNoOf = (feature) => text(feature.properties.merchantNo);
const merchantNameOf = (feature) => text(feature.properties.merchantName);
const hasMerchantInfo = (feature) =>
  Boolean(merchantNoOf(feature) || merchantNameOf(feature));

function analyzeNewCodes(features) {
  const missing = features.filter(
    (feature) => !text(feature.properties.code),
  ).length;

  return { missing, duplicated: findDuplicateCodes(features) };
}

function compareByCode(oldShops, newShops) {
  const oldFeatures = oldShops?.features ?? [];
  const newFeatures = newShops?.features ?? [];

  const numberedOld = oldFeatures.filter((feature) =>
    text(feature.properties.code),
  );
  const unnumberedOld = oldFeatures.filter(
    (feature) => !text(feature.properties.code),
  );

  const oldByCode = new Map();
  const duplicatedOld = new Set();
  for (const feature of numberedOld) {
    const code = text(feature.properties.code);
    if (oldByCode.has(code)) duplicatedOld.add(code);
    else oldByCode.set(code, feature);
  }

  const matched = [];
  const matchedOldUids = new Set();
  for (const feature of newFeatures) {
    const code = text(feature.properties.code);
    if (!code || duplicatedOld.has(code)) continue;
    const old = oldByCode.get(code);
    if (!old) continue;
    matched.push({ old, next: feature });
    matchedOldUids.add(old.properties.uid);
  }

  const failedOld = numberedOld.filter(
    (feature) => !matchedOldUids.has(feature.properties.uid),
  );
  const newOnly = newFeatures.filter(
    (feature) => !matched.some((pair) => pair.next.properties.uid === feature.properties.uid),
  );

  return { matched, failedOld, newOnly, duplicatedOld, unnumberedOld };
}

function applyOldProps(props, oldProps) {
  const next = { ...props };
  const oldCode = text(oldProps.code);
  if (!text(props.code) && oldCode) {
    next.code = oldCode;
    next.label = oldCode;
  }
  const merchantNo = text(oldProps.merchantNo);
  const merchantName = text(oldProps.merchantName);
  if (merchantNo) next.merchantNo = merchantNo;
  if (merchantName) next.merchantName = merchantName;
  return next;
}

function mergeMerchantInfo(newData, oldShops, pairs) {
  const oldPropsByUid = new Map(
    (oldShops?.features ?? []).map((feature) => [
      feature.properties.uid,
      feature.properties,
    ]),
  );
  const oldByNewUid = new Map();
  for (const { oldUid, newUid } of pairs) {
    const oldProps = oldPropsByUid.get(oldUid);
    if (oldProps) oldByNewUid.set(newUid, oldProps);
  }

  const mergeShops = newData.shops.features.map((feature) => {
    const oldProps = oldByNewUid.get(feature.properties.uid);
    return oldProps
      ? { ...feature, properties: applyOldProps(feature.properties, oldProps) }
      : feature;
  });

  const rawFeatures = newData.raw?.features;
  const raw = rawFeatures
    ? {
        ...newData.raw,
        features: rawFeatures.map((feature) => {
          const oldProps = oldByNewUid.get(feature.properties?.uid);
          return oldProps
            ? {
                ...feature,
                properties: applyOldProps(feature.properties ?? {}, oldProps),
              }
            : feature;
        }),
      }
    : newData.raw;

  return {
    ...newData,
    shops: { ...newData.shops, features: mergeShops },
    raw,
  };
}

const merchantCell = (value) =>
  value ? value : <Text type="secondary">—</Text>;

export default function FloorGeoJsonCompare({
  open,
  oldShops,
  newData,
  onCancel,
  onConfirm,
  onHoverTarget,
}) {
  const [targets, setTargets] = useState({});

  const oldFeatures = oldShops?.features ?? [];
  const newFeatures = newData?.shops?.features ?? [];
  const ordinalByUid = new Map(
    newFeatures.map((feature, index) => [feature.properties.uid, index + 1]),
  );

  const { matched, failedOld, newOnly, duplicatedOld, unnumberedOld } = useMemo(
    () => compareByCode(oldShops, newData?.shops),
    [oldShops, newData],
  );
  const codeIssues = useMemo(
    () => analyzeNewCodes(newData?.shops?.features ?? []),
    [newData],
  );

  useEffect(() => {
    if (open) setTargets({});
  }, [open, newData]);

  const matchedUids = new Set(
    matched.map((pair) => pair.next.properties.uid),
  );
  const unmappedNewFeatures = newFeatures.filter(
    (feature) => !matchedUids.has(feature.properties.uid),
  );

  const optionsFor = (oldUid) =>
    unmappedNewFeatures
      .filter((feature) => {
        const uid = feature.properties.uid;
        const owner = Object.entries(targets).find(([, value]) => value === uid);
        return !owner || owner[0] === oldUid;
      })
      .map((feature) => {
        const numbered = Boolean(text(feature.properties.code));
        return {
          value: feature.properties.uid,
          label: `${optionText(feature, ordinalByUid)}${
            numbered ? "" : " · 将取旧铺位号"
          }`,
          feature,
        };
      });

  const hasUnnumberedTarget = unmappedNewFeatures.some(
    (feature) => !text(feature.properties.code),
  );

  const blocked = codeIssues.duplicated.length > 0;

  const discardedCount = failedOld.filter(
    (feature) => hasMerchantInfo(feature) && !targets[feature.properties.uid],
  ).length;

  const handleConfirm = () => {
    const pairs = [
      ...matched.map(({ old, next }) => ({
        oldUid: old.properties.uid,
        newUid: next.properties.uid,
      })),
      ...failedOld
        .filter((feature) => targets[feature.properties.uid])
        .map((feature) => ({
          oldUid: feature.properties.uid,
          newUid: targets[feature.properties.uid],
        })),
    ];
    onConfirm(mergeMerchantInfo(newData, oldShops, pairs));
  };

  const matchedColumns = [
    {
      title: "铺位号",
      key: "code",
      ellipsis: true,
      render: (_, pair) => codeOf(pair.next),
    },
    {
      title: "旧商户号",
      key: "merchantNo",
      width: 96,
      ellipsis: true,
      render: (_, pair) => merchantCell(merchantNoOf(pair.old)),
    },
    {
      title: "旧商户名称",
      key: "merchantName",
      width: 120,
      ellipsis: true,
      render: (_, pair) => merchantCell(merchantNameOf(pair.old)),
    },
  ];

  const failedColumns = [
    {
      title: "旧铺位号",
      key: "code",
      width: 88,
      ellipsis: true,
      render: (_, feature) => codeOf(feature),
    },
    {
      title: "旧商户号",
      key: "merchantNo",
      width: 92,
      ellipsis: true,
      render: (_, feature) => merchantCell(merchantNoOf(feature)),
    },
    {
      title: "旧商户名称",
      key: "merchantName",
      width: 112,
      ellipsis: true,
      render: (_, feature) => merchantCell(merchantNameOf(feature)),
    },
    {
      title: "匹配到新铺位",
      key: "target",
      width: 210,
      render: (_, feature) => (
        <Select
          allowClear
          showSearch
          optionFilterProp="searchLabel"
          placeholder="不迁移"
          style={{ width: "100%" }}
          value={targets[feature.properties.uid]}
          options={optionsFor(feature.properties.uid).map((option) => ({
            value: option.value,
            searchLabel: option.label,
            label: (
              <div
                onMouseEnter={() => onHoverTarget?.(option.value)}
                onMouseLeave={() => onHoverTarget?.(null)}
              >
                {option.label}
              </div>
            ),
          }))}
          onDropdownVisibleChange={(nextOpen) => {
            if (!nextOpen) onHoverTarget?.(null);
          }}
          onChange={(value) =>
            setTargets((prev) => ({
              ...prev,
              [feature.properties.uid]: value,
            }))
          }
        />
      ),
    },
  ];

  const newOnlyColumns = [
    {
      title: "新铺位号",
      key: "code",
      ellipsis: true,
      render: (_, feature) => optionText(feature, ordinalByUid),
    },
  ];

  const unnumberedColumns = [
    {
      title: "旧铺位号",
      key: "code",
      width: 88,
      render: () => "未编号",
    },
    {
      title: "旧商户号",
      key: "merchantNo",
      width: 96,
      ellipsis: true,
      render: (_, feature) => merchantCell(merchantNoOf(feature)),
    },
    {
      title: "旧商户名称",
      key: "merchantName",
      width: 120,
      ellipsis: true,
      render: (_, feature) => merchantCell(merchantNameOf(feature)),
    },
  ];

  return (
    <Drawer
      open={open}
      placement="left"
      width="min(680px, 92vw)"
      mask={false}
      title="新地图与现有铺位比对"
      onClose={onCancel}
      destroyOnClose
      footer={
        <Space style={{ display: "flex", justifyContent: "flex-end" }}>
          <Button onClick={onCancel}>取消</Button>
          <Button
            type="primary"
            disabled={blocked}
            onClick={handleConfirm}
          >
            确认并应用
          </Button>
        </Space>
      }
    >
      <Space
        size={8}
        wrap
        style={{ marginBottom: 16 }}
      >
        <Tag>新地图 {newFeatures.length} 个铺位</Tag>
        <Tag>旧数据 {oldFeatures.length} 个铺位</Tag>
        <Tag color="green">匹配成功 {matched.length}</Tag>
        <Tag color={failedOld.length ? "orange" : "default"}>
          匹配失败 {failedOld.length}
        </Tag>
        {unnumberedOld.length > 0 && (
          <Tag>未编号旧铺位 {unnumberedOld.length}（自动跳过）</Tag>
        )}
        <Tag color="blue">新增铺位 {newOnly.length}</Tag>
      </Space>

      {blocked && (
        <Alert
          type="error"
          showIcon
          style={{ marginBottom: 16 }}
          message="新地图铺位号不合法，无法覆盖"
          description={[
            codeIssues.missing ? `${codeIssues.missing} 个铺位缺少铺位号` : "",
            codeIssues.duplicated.length
              ? `重复铺位号：${codeIssues.duplicated.join("、")}`
              : "",
          ]
            .filter(Boolean)
            .join("；")}
        />
      )}

      {duplicatedOld.size > 0 && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 16 }}
          message={`旧数据存在重复铺位号：${[...duplicatedOld].join("、")}`}
          description="重复的旧铺位按匹配失败处理，可手动指定新铺位。"
        />
      )}

      <Typography.Title
        level={5}
        style={{ marginTop: 0 }}
      >
        匹配成功
      </Typography.Title>
      <Table
        size="small"
        tableLayout="fixed"
        rowKey={(pair) => pair.old.properties.uid}
        columns={matchedColumns}
        dataSource={matched}
        pagination={false}
        scroll={{ y: 220 }}
        locale={{ emptyText: "没有同号铺位" }}
        style={{ marginBottom: 20 }}
      />

      <Typography.Title level={5}>匹配失败（旧有新无）</Typography.Title>
      <Table
        size="small"
        tableLayout="fixed"
        rowKey={(feature) => feature.properties.uid}
        columns={failedColumns}
        dataSource={failedOld}
        pagination={false}
        scroll={{ y: 220 }}
        locale={{ emptyText: "旧铺位全部匹配成功" }}
      />

      <Typography.Title
        level={5}
        style={{ marginTop: 20 }}
      >
        新增铺位（新有旧无）
      </Typography.Title>
      <Table
        size="small"
        tableLayout="fixed"
        rowKey={(feature) => feature.properties.uid}
        columns={newOnlyColumns}
        dataSource={newOnly}
        pagination={false}
        scroll={{ y: 180 }}
        locale={{ emptyText: "没有新增铺位" }}
      />

      {/* {unnumberedOld.length > 0 && (
        <>
          <Typography.Title
            level={5}
            style={{ marginTop: 20 }}
          >
            未编号旧铺位（自动跳过）
          </Typography.Title>
          <Table
            size="small"
            tableLayout="fixed"
            rowKey={(feature) => feature.properties.uid}
            columns={unnumberedColumns}
            dataSource={unnumberedOld}
            pagination={false}
            scroll={{ y: 180 }}
            locale={{ emptyText: "没有未编号旧铺位" }}
          />
        </>
      )} */}

      <Space
        direction="vertical"
        size={4}
        style={{ marginTop: 16 }}
      >
        <Text type="secondary">
          匹配成功的铺位使用新地图几何，商户号和商户名称取自旧数据（旧值为空时保留新值）。
        </Text>
        {hasUnnumberedTarget && (
          <Text type="secondary">
            手动匹配到未编号的新铺位时，应用后该铺位直接使用旧铺位号。
          </Text>
        )}
        {unnumberedOld.length > 0 && (
          <Text type="secondary">
            未编号旧铺位没有维护过商户信息，已自动跳过，无需逐一确认。
          </Text>
        )}
        {newOnly.length > 0 && (
          <Text type="secondary">
            新增铺位无对应旧信息，不会写入商户号或商户名称。
          </Text>
        )}
        {discardedCount > 0 && (
          <Text type="warning">
            仍有 {discardedCount} 条带商户信息的旧铺位未匹配，确认后将丢弃这些商户信息。
          </Text>
        )}
      </Space>
    </Drawer>
  );
}
