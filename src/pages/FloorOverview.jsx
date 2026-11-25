import { useCallback, useEffect, useRef, useState } from "react";
import { Button, Card, Empty, Result, Spin, Tag, message } from "antd";
import { AimOutlined } from "@ant-design/icons";
import FloorNavigationModal from "../components/FloorNavigationModal/index.jsx";
import FloorStaticMap from "../components/FloorStaticMap/index.jsx";
import { loadFloorScene } from "../lib/floorScene.js";
import {
  compareFloors,
  facilityLabel,
  merchantLabel,
} from "../lib/navSelection.js";
import { listMaps } from "../services/maps.js";
import { listPlacedMerchants } from "../services/merchants.js";
import pageStyles from "../styles/page.less";
import styles from "./FloorOverview.less";

export default function FloorOverview() {
  const [floors, setFloors] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState(null);
  const [listVersion, setListVersion] = useState(0);
  const [activeId, setActiveId] = useState(null);
  const [scene, setScene] = useState(null);
  const [sceneLoading, setSceneLoading] = useState(false);
  const [sceneError, setSceneError] = useState(null);
  const [sceneVersion, setSceneVersion] = useState(0);
  const sceneSeqRef = useRef(0);
  const [merchants, setMerchants] = useState([]);
  const [merchantsLoading, setMerchantsLoading] = useState(false);
  const [merchantsError, setMerchantsError] = useState(null);
  const [navOpen, setNavOpen] = useState(false);
  const [navInitialValue, setNavInitialValue] = useState(null);
  const [navSelection, setNavSelection] = useState(null);
  const merchantsLoadedRef = useRef(false);
  const merchantSeqRef = useRef(0);

  useEffect(() => {
    let active = true;
    setListLoading(true);
    setListError(null);

    listMaps()
      .then((list) => {
        if (!active) return;
        const sorted = [...(list ?? [])].sort(compareFloors);
        setFloors(sorted);
        setActiveId(sorted[0]?.id ?? null);
      })
      .catch((error) => {
        if (active) setListError(error);
      })
      .finally(() => {
        if (active) setListLoading(false);
      });

    return () => {
      active = false;
    };
  }, [listVersion]);

  useEffect(() => {
    if (!activeId) return undefined;

    // 快速连点楼层时用代次丢弃迟到响应，避免旧楼层覆盖新楼层
    const seq = ++sceneSeqRef.current;
    setSceneLoading(true);
    setSceneError(null);

    loadFloorScene(activeId)
      .then((detail) => {
        if (seq !== sceneSeqRef.current) return;
        setScene({ floorId: activeId, ...detail });
      })
      .catch((error) => {
        if (seq !== sceneSeqRef.current) return;
        if (error.status !== 404) {
          message.error(error.message || "楼层地图加载失败");
        }
        setSceneError(error);
      })
      .finally(() => {
        if (seq === sceneSeqRef.current) setSceneLoading(false);
      });

    return () => {
      if (sceneSeqRef.current === seq) sceneSeqRef.current += 1;
    };
  }, [activeId, sceneVersion]);

  const loadPlacedMerchants = useCallback(() => {
    const seq = ++merchantSeqRef.current;
    setMerchantsLoading(true);
    setMerchantsError(null);

    listPlacedMerchants()
      .then((list) => {
        if (seq !== merchantSeqRef.current) return;
        setMerchants(Array.isArray(list) ? list : []);
        merchantsLoadedRef.current = true;
      })
      .catch((error) => {
        if (seq !== merchantSeqRef.current) return;
        setMerchantsError(error);
      })
      .finally(() => {
        if (seq === merchantSeqRef.current) setMerchantsLoading(false);
      });
  }, []);

  const openNavigation = () => {
    setNavInitialValue(
      navSelection
        ? {
            startId: navSelection.start.id,
            endMode: navSelection.end.kind,
            endShopId:
              navSelection.end.kind === "shop"
                ? navSelection.end.merchant.id
                : null,
            facilityKind:
              navSelection.end.kind === "facility"
                ? navSelection.end.facilityKind
                : null,
          }
        : null,
    );
    setNavOpen(true);

    if (!merchantsLoadedRef.current && !merchantsLoading) {
      loadPlacedMerchants();
    }
  };

  const handleNavigationConfirm = (selection) => {
    setNavSelection(selection);
    setNavOpen(false);
  };

  const navStartLabel = navSelection ? merchantLabel(navSelection.start) : "";
  const navEndLabel = navSelection
    ? navSelection.end.kind === "shop"
      ? merchantLabel(navSelection.end.merchant)
      : facilityLabel(navSelection.end.facilityKind)
    : "";
  const navSummaryHint = navSelection
    ? navSelection.crossFloor
      ? "跨楼层导航待接入"
      : navSelection.end.kind === "facility"
      ? "导航待接入 · 将自动选择最近设施"
      : "导航待接入"
    : "";

  const listBody = () => {
    if (listError) {
      return (
        <Result
          status="error"
          title="楼层列表加载失败"
          subTitle={listError.message || "请稍后重试。"}
          extra={
            <Button
              type="primary"
              onClick={() => setListVersion((version) => version + 1)}
            >
              重试
            </Button>
          }
        />
      );
    }

    if (listLoading) {
      return (
        <div className={styles.pageLoading}>
          <Spin />
          <span>正在加载楼层列表…</span>
        </div>
      );
    }

    if (!floors.length) {
      return (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description="暂无楼层，请先在楼层管理中新增"
          style={{ margin: "auto", padding: "80px 0" }}
        />
      );
    }

    return (
      <div className={styles.overviewBody}>
        <nav className={styles.floorRail} aria-label="楼层切换">
          {floors.map((floor) => (
            <button
              type="button"
              key={floor.id}
              title={floor.name}
              className={`${styles.floorButton} ${
                floor.id === activeId ? styles.isActive : ""
              }`}
              aria-pressed={floor.id === activeId}
              onClick={() => setActiveId(floor.id)}
            >
              {floor.floorCode}
            </button>
          ))}
        </nav>

        <div className={styles.mapArea}>
          {scene ? (
            scene.shops?.features?.length ? (
              <FloorStaticMap shops={scene.shops} floor={scene.floor} />
            ) : (
              <div className={styles.mapPlaceholder}>
                <Empty
                  image={Empty.PRESENTED_IMAGE_SIMPLE}
                  description="该楼层暂未录入商铺地图数据"
                />
              </div>
            )
          ) : sceneError ? (
            <div className={styles.mapPlaceholder} />
          ) : (
            <div className={styles.mapPlaceholder}>
              <Spin size="large" />
            </div>
          )}

          {sceneLoading && scene && (
            <div className={styles.spinMask}>
              <Spin size="large" />
            </div>
          )}

          {sceneError && (
            <div className={styles.errorMask}>
              <Result
                status={sceneError.status === 404 ? "404" : "error"}
                title={
                  sceneError.status === 404 ? "楼层不存在" : "楼层地图加载失败"
                }
                subTitle={
                  sceneError.status === 404
                    ? "该楼层可能已被删除，请刷新楼层列表。"
                    : sceneError.message || "请稍后重试。"
                }
                extra={
                  sceneError.status === 404 ? (
                    <Button
                      type="primary"
                      onClick={() => setListVersion((version) => version + 1)}
                    >
                      刷新列表
                    </Button>
                  ) : (
                    <Button
                      type="primary"
                      onClick={() => setSceneVersion((version) => version + 1)}
                    >
                      重试
                    </Button>
                  )
                }
              />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={`${pageStyles.pageStack} ${styles.overviewPage}`}>
      <Card
        size="small"
        className={styles.overviewCard}
        title="全楼层预览"
        extra={
          <Button
            size="small"
            type="primary"
            icon={<AimOutlined />}
            onClick={openNavigation}
          >
            导航
          </Button>
        }
      >
        <div className={styles.cardContent}>
          {navSelection && (
            <div className={styles.navSummary}>
              <div className={styles.navSummaryMain}>
                <div className={styles.navSummaryTitle}>
                  <span>{navStartLabel}</span>
                  <span aria-hidden="true">→</span>
                  <span>{navEndLabel}</span>
                  {navSelection.crossFloor && (
                    <Tag color="orange">跨楼层待支持</Tag>
                  )}
                </div>
                <div className={styles.navSummaryHint}>{navSummaryHint}</div>
              </div>
              <div className={styles.navSummaryActions}>
                <Button type="link" size="small" onClick={openNavigation}>
                  修改
                </Button>
                <Button
                  type="link"
                  size="small"
                  onClick={() => setNavSelection(null)}
                >
                  清除
                </Button>
              </div>
            </div>
          )}

          {listBody()}
        </div>
      </Card>

      <FloorNavigationModal
        open={navOpen}
        merchants={merchants}
        loading={merchantsLoading}
        error={merchantsError}
        onRetry={loadPlacedMerchants}
        initialValue={navInitialValue}
        onCancel={() => setNavOpen(false)}
        onConfirm={handleNavigationConfirm}
      />
    </div>
  );
}
