import React, { useEffect, useMemo, useState } from "react";
import { Alert, Button, Empty, Modal, Segmented, Select, Space } from "antd";
import AreaTypeSelect from "../AreaTypeSelect/index.jsx";
import {
  BothToiletIcon,
  ElevatorIcon,
  FemaleToiletIcon,
  MaleToiletIcon,
  NursingIcon,
} from "../AreaTypeSelect/icons.jsx";
import {
  FACILITY_OPTIONS,
  compareMerchants,
  isCrossFloor,
  merchantLabel,
  merchantSearchText,
} from "../../lib/navSelection.js";
import styles from "./index.less";

const FACILITY_ICONS = {
  "toilet-male": <MaleToiletIcon />,
  "toilet-female": <FemaleToiletIcon />,
  "toilet-any": <BothToiletIcon />,
  elevator: <ElevatorIcon />,
  nursing: <NursingIcon />,
};

const FACILITY_CARDS = FACILITY_OPTIONS.map((option) => ({
  ...option,
  icon: FACILITY_ICONS[option.value],
}));

const END_MODE_OPTIONS = [
  { label: "商铺", value: "shop" },
  { label: "设施", value: "facility" },
];

const merchantFilter = (input, option) => {
  const keyword = input.trim().toLowerCase();
  if (!keyword) return true;
  return (option.searchText || "").toLowerCase().includes(keyword);
};

export default function FloorNavigationModal({
  open,
  merchants = [],
  loading = false,
  error = null,
  onRetry,
  initialValue,
  onCancel,
  onConfirm,
}) {
  const [startId, setStartId] = useState(null);
  const [endMode, setEndMode] = useState("shop");
  const [endShopId, setEndShopId] = useState(null);
  const [facilityKind, setFacilityKind] = useState(null);

  useEffect(() => {
    if (!open) return;
    setStartId(initialValue?.startId ?? null);
    setEndMode(initialValue?.endMode === "facility" ? "facility" : "shop");
    setEndShopId(initialValue?.endShopId ?? null);
    setFacilityKind(initialValue?.facilityKind ?? null);
  }, [open]);

  const sortedMerchants = useMemo(
    () => [...merchants].sort(compareMerchants),
    [merchants],
  );

  const merchantOptions = useMemo(() => {
    const counts = new Map();
    for (const merchant of sortedMerchants) {
      const key = merchantLabel(merchant);
      counts.set(key, (counts.get(key) || 0) + 1);
    }

    return sortedMerchants.map((merchant) => {
      const base = merchantLabel(merchant);
      const label =
        counts.get(base) > 1 && merchant.boothCode
          ? `${base} · ${merchant.boothCode}`
          : base;
      return {
        value: merchant.id,
        label,
        searchText: merchantSearchText(merchant),
      };
    });
  }, [sortedMerchants]);

  const startMerchant =
    sortedMerchants.find((merchant) => merchant.id === startId) || null;
  const endMerchant =
    sortedMerchants.find((merchant) => merchant.id === endShopId) || null;

  const crossFloor =
    endMode === "shop" &&
    Boolean(startMerchant && endMerchant) &&
    isCrossFloor(startMerchant, endMerchant);

  const startOptions =
    endMode === "shop" && endShopId
      ? merchantOptions.filter((option) => option.value !== endShopId)
      : merchantOptions;
  const endOptions = merchantOptions.filter(
    (option) => option.value !== startId,
  );

  const canConfirm =
    !loading &&
    Boolean(startMerchant) &&
    (endMode === "shop"
      ? Boolean(endMerchant) && endMerchant.id !== startMerchant.id
      : Boolean(facilityKind));

  const handleStartChange = (value) => {
    const next = value ?? null;
    setStartId(next);
    if (endShopId === next) setEndShopId(null);
  };

  const handleConfirm = () => {
    if (!canConfirm) return;
    onConfirm({
      start: startMerchant,
      end:
        endMode === "shop"
          ? { kind: "shop", merchant: endMerchant }
          : { kind: "facility", facilityKind },
      crossFloor,
    });
  };

  return (
    <Modal
      title="选择导航起点与终点"
      open={open}
      width={560}
      onCancel={onCancel}
      destroyOnClose
      footer={
        <Space>
          <Button onClick={onCancel}>取消</Button>
          <Button type="primary" disabled={!canConfirm} onClick={handleConfirm}>
            确定选择
          </Button>
        </Space>
      }
    >
      <div className={styles.modalBody}>
        {error && (
          <Alert
            type="error"
            showIcon
            message="商户列表加载失败"
            description={error.message || "请稍后重试。"}
            action={
              onRetry ? (
                <Button size="small" onClick={onRetry} loading={loading}>
                  重试
                </Button>
              ) : null
            }
          />
        )}

        <div className={styles.field}>
          <div className={styles.fieldLabel}>起点商铺</div>
          <Select
            className={styles.select}
            placeholder="搜索商户名 / 楼层 / 铺位号"
            options={startOptions}
            value={startId ?? undefined}
            onChange={handleStartChange}
            showSearch
            allowClear
            loading={loading}
            filterOption={merchantFilter}
            notFoundContent={loading ? "正在加载…" : "暂无已关联商户"}
            disabled={Boolean(error) && !merchants.length}
          />
        </div>

        <div className={styles.field}>
          <div className={styles.fieldHead}>
            <span className={styles.fieldLabel}>终点</span>
            <Segmented
              options={END_MODE_OPTIONS}
              value={endMode}
              onChange={setEndMode}
            />
          </div>

          {endMode === "shop" ? (
            <Select
              className={styles.select}
              placeholder="搜索商户名 / 楼层 / 铺位号"
              options={endOptions}
              value={endShopId ?? undefined}
              onChange={(value) => setEndShopId(value ?? null)}
              showSearch
              allowClear
              loading={loading}
              filterOption={merchantFilter}
              notFoundContent={loading ? "正在加载…" : "暂无已关联商户"}
              disabled={Boolean(error) && !merchants.length}
            />
          ) : (
            <AreaTypeSelect
              value={facilityKind}
              options={FACILITY_CARDS}
              onChange={setFacilityKind}
            />
          )}
        </div>

        {endMode === "facility" && (
          <p className={styles.hint}>
            导航接入后会自动选择离起点最近的一个设施。
          </p>
        )}

        {crossFloor && (
          <Alert
            type="warning"
            showIcon
            message="跨楼层导航待支持"
            description={`起点在 ${
              startMerchant.floorCode || "未知楼层"
            }，终点在 ${
              endMerchant.floorCode || "未知楼层"
            }。可以先保存这次选择，等跨楼层导航接入后再使用。`}
          />
        )}

        {!loading && !error && !merchants.length && (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="暂无已关联商户"
            className={styles.empty}
          />
        )}
      </div>
    </Modal>
  );
}
