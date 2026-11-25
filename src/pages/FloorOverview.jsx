import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, Empty, Result, Spin, Tag, message } from "antd";
import { AimOutlined } from "@ant-design/icons";
import FloorNavigationModal from "../components/FloorNavigationModal/index.jsx";
import FloorStaticMap from "../components/FloorStaticMap/index.jsx";
import RouteFloorSteps from "../components/RouteFloorSteps/index.jsx";
import { loadFloorScene } from "../lib/floorScene.js";
import {
  computeFacilityRoute,
  computeNavigationRoute,
  elevatorShafts,
  loadFloorShafts,
} from "../lib/crossFloorRouting.js";
import {
  availableFacilityKinds,
  compareFloors,
  facilityLabel,
  findFloorByCode,
  merchantLabel,
  resolveShopFeature,
} from "../lib/navSelection.js";
import { listMaps } from "../services/maps.js";
import { listPlacedMerchants } from "../services/merchants.js";
import pageStyles from "../styles/page.less";
import styles from "./FloorOverview.less";

function formatDuration(seconds) {
  if (!Number.isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.max(5, Math.round(seconds / 5) * 5)} 秒`;
  return `${Math.round(seconds / 60)} 分钟`;
}

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
  const [navRoute, setNavRoute] = useState(null);
  const merchantsLoadedRef = useRef(false);
  const merchantSeqRef = useRef(0);
  const sceneCacheRef = useRef(new Map());
  const navRunSeqRef = useRef(0);
  const pendingNavRef = useRef(null);

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

  const loadSceneCached = useCallback((floorId) => {
    if (!sceneCacheRef.current.has(floorId)) {
      sceneCacheRef.current.set(floorId, loadFloorScene(floorId));
    }
    return sceneCacheRef.current.get(floorId);
  }, []);

  const runNavigation = useCallback(
    async (selection) => {
      // 迟到的旧计算结果不覆盖新选择
      const seq = ++navRunSeqRef.current;
      setNavRoute({ loading: true, error: null, plan: null });
      try {
        const startFloor = findFloorByCode(floors, selection.start.floorCode);
        if (!startFloor) {
          throw new Error(`起点所在楼层「${selection.start.floorCode}」不存在`);
        }
        const startScene = await loadSceneCached(startFloor.id);
        const startFeature = resolveShopFeature(
          startScene.shops.features,
          selection.start,
        );
        if (!startFeature) throw new Error("起点铺位未在该楼层地图中找到");

        let plan;
        if (selection.end.kind === "shop") {
          const endMerchant = selection.end.merchant;
          const endFloor = findFloorByCode(floors, endMerchant.floorCode);
          if (!endFloor) {
            throw new Error(`终点所在楼层「${endMerchant.floorCode}」不存在`);
          }
          const endScene = await loadSceneCached(endFloor.id);
          const endFeature = resolveShopFeature(
            endScene.shops.features,
            endMerchant,
          );
          if (!endFeature) throw new Error("终点铺位未在该楼层地图中找到");

          const crossFloor = startFloor.id !== endFloor.id;
          const floorById = new Map(floors.map((floor) => [floor.id, floor]));
          const ensureScene = crossFloor
            ? async (floorId) => {
                const detail = await loadSceneCached(floorId);
                return {
                  floorId,
                  floorCode: floorById.get(floorId)?.floorCode ?? "",
                  shops: detail.shops,
                  floor: detail.floor,
                };
              }
            : null;
          const inventory = crossFloor
            ? await Promise.all(
                floors.map(async (floor) => {
                  if (floor.id === startFloor.id) {
                    return {
                      floorId: floor.id,
                      floorCode: floor.floorCode,
                      shafts: elevatorShafts(startScene.shops.features),
                    };
                  }
                  if (floor.id === endFloor.id) {
                    return {
                      floorId: floor.id,
                      floorCode: floor.floorCode,
                      shafts: elevatorShafts(endScene.shops.features),
                    };
                  }
                  const shafts = await loadFloorShafts(floor.id).catch(() => []);
                  return {
                    floorId: floor.id,
                    floorCode: floor.floorCode,
                    shafts,
                  };
                }),
              )
            : [];

          plan = await computeNavigationRoute({
            startScene: {
              floorId: startFloor.id,
              floorCode: startFloor.floorCode,
              shops: startScene.shops,
              floor: startScene.floor,
            },
            endScene: {
              floorId: endFloor.id,
              floorCode: endFloor.floorCode,
              shops: endScene.shops,
              floor: endScene.floor,
            },
            startFeature,
            endFeature,
            inventory,
            loadScene: ensureScene,
          });
        } else {
          // 设施终点：只在起点所在楼层（即当前楼层）寻找
          plan = computeFacilityRoute({
            scene: {
              floorId: startFloor.id,
              floorCode: startFloor.floorCode,
              shops: startScene.shops,
              floor: startScene.floor,
            },
            startFeature,
            facilityKind: selection.end.facilityKind,
          });
        }

        if (seq !== navRunSeqRef.current) return;
        setNavRoute({ loading: false, error: null, plan });
        setActiveId(plan.startFloorId);
      } catch (err) {
        if (seq !== navRunSeqRef.current) return;
        setNavRoute({
          loading: false,
          error: err.message || "路线计算失败",
          plan: null,
        });
      }
    },
    [floors, loadSceneCached],
  );

  const flushPendingNav = () => {
    const selection = pendingNavRef.current;
    pendingNavRef.current = null;
    if (selection) runNavigation(selection);
  };

  const openNavigation = () => {
    // 弹窗还没走完离场就被重新打开时，afterClose 可能不再触发，先把待算的路线放出去
    flushPendingNav();
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

  // 路线计算是同步重任务（建栅格 + A*，约 0.1-1s），必须在弹窗离场动画
  // 结束、浏览器能绘制之后再跑，否则第二次导航（场景已缓存）会把弹窗冻在屏幕上
  const handleNavigationConfirm = (selection) => {
    if (pendingNavRef.current) return;
    pendingNavRef.current = selection;
    setNavOpen(false);
    setNavSelection(selection);
    setNavRoute({ loading: true, error: null, plan: null });
  };

  const handleNavCancel = () => {
    pendingNavRef.current = null;
    setNavOpen(false);
  };

  const clearNavigation = () => {
    setNavSelection(null);
    setNavRoute(null);
  };

  const activeFloor = floors.find((floor) => floor.id === activeId) ?? null;
  const activeFloorCode = activeFloor?.floorCode ?? null;

  const facilityAvailability = useMemo(
    () => (scene ? availableFacilityKinds(scene.shops.features) : new Set()),
    [scene],
  );

  const navStartLabel = navSelection ? merchantLabel(navSelection.start) : "";
  const navEndLabel = navSelection
    ? navSelection.end.kind === "shop"
      ? merchantLabel(navSelection.end.merchant)
      : facilityLabel(navSelection.end.facilityKind)
    : "";

  const navSummaryHint = (() => {
    if (!navSelection) return "";
    if (navRoute?.loading) return "正在计算路线…";
    if (navRoute?.error) return navRoute.error;
    const plan = navRoute?.plan;
    if (!plan) return "";
    const rides = plan.rides ?? [];
    const ride = rides.length
      ? ` · 乘 ${rides.map((item) => item.shaftName).join(" → ")}`
      : "";
    return `${Math.round(plan.distance)} m · 约 ${formatDuration(
      plan.duration,
    )}${ride}`;
  })();

  const activeRoute = useMemo(() => {
    const plan = navRoute?.plan;
    if (!plan) return null;
    const walk = plan.segments.find(
      (segment) => segment.kind === "walk" && segment.floorId === activeId,
    );
    return walk?.coordinates ?? null;
  }, [navRoute, activeId]);

  const activePins = useMemo(() => {
    const plan = navRoute?.plan;
    if (!plan) return [];
    const pins = [];
    if (activeId === plan.startFloorId) {
      pins.push({ lngLat: plan.startPoint, type: "start" });
    }
    if (activeId === plan.endFloorId) {
      pins.push({ lngLat: plan.endPoint, type: "end" });
    }
    for (const segment of plan.segments) {
      if (segment.kind !== "connector") continue;
      if (segment.fromFloorId === activeId) {
        pins.push({ lngLat: segment.from, type: "transfer" });
      }
      if (segment.toFloorId === activeId) {
        pins.push({ lngLat: segment.to, type: "transfer" });
      }
    }
    return pins;
  }, [navRoute, activeId]);

  const routeSteps = useMemo(() => {
    const plan = navRoute?.plan;
    if (!plan?.steps?.length) return [];
    return plan.steps.map((step) => ({
      ...step,
      label:
        step.role === "start"
          ? navStartLabel
          : step.role === "end"
          ? navEndLabel
          : step.label || "",
    }));
  }, [navRoute, navStartLabel, navEndLabel]);

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
              <FloorStaticMap
                shops={scene.shops}
                floor={scene.floor}
                route={activeRoute}
                pins={activePins}
                fitPaddingBottom={routeSteps.length ? 88 : 0}
              />
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

          <RouteFloorSteps
            steps={routeSteps}
            activeFloorId={activeId}
            onChangeFloor={setActiveId}
          />

          {(navRoute?.loading || (sceneLoading && scene)) && (
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
                  {navRoute?.plan && !navRoute.plan.sameFloor && (
                    <Tag color="blue">跨层</Tag>
                  )}
                  {navRoute?.plan?.steps?.some(
                    (step) => step.role === "transfer",
                  ) && (
                    <Tag color="orange">
                      换乘{" "}
                      {
                        navRoute.plan.steps.filter(
                          (step) => step.role === "transfer",
                        ).length
                      }{" "}
                      次
                    </Tag>
                  )}
                </div>
                <div
                  className={`${styles.navSummaryHint} ${
                    navRoute?.error ? styles.navSummaryError : ""
                  }`}
                >
                  {navSummaryHint}
                </div>
              </div>
              <div className={styles.navSummaryActions}>
                <Button type="link" size="small" onClick={openNavigation}>
                  修改
                </Button>
                <Button type="link" size="small" onClick={clearNavigation}>
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
        routeLoading={navRoute?.loading}
        error={merchantsError}
        onRetry={loadPlacedMerchants}
        initialValue={navInitialValue}
        activeFloorCode={activeFloorCode}
        facilityAvailability={facilityAvailability}
        facilitiesLoading={sceneLoading}
        onCancel={handleNavCancel}
        onConfirm={handleNavigationConfirm}
        afterClose={flushPendingNav}
      />
    </div>
  );
}
