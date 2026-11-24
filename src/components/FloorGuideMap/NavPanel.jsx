import { Select } from "antd";
import { formatDuration, numberFormat } from "./previewCore.js";
import styles from "./FloorGuideMap.less";

export default function NavPanel({
  panelRef,
  stats,
  navStatus,
  navMode,
  nav,
  is3D,
  selectStart,
  selectEnd,
  shopOptions,
  navApiRef,
  onChangeNavMode,
  onSelectShop,
  onResetSelectRoute,
  onViewModeChange,
  onFitAll,
}) {
  return (
    <aside className={styles.fpPanel} ref={panelRef}>
      <div className={styles.fpEyebrow}>楼层导览预览</div>
      <p className={styles.fpSummary}>
        {stats ? (
          <>
            <strong>{stats.count}</strong> 间铺位 · 合计{" "}
            <strong>{numberFormat.format(stats.totalArea)}</strong> m²
          </>
        ) : (
          "正在加载铺位数据…"
        )}
      </p>

      <div className={styles.fpNav}>
        <div className={styles.fpNavHeading}>铺位间导航</div>

        <div className={styles.fpNavMode} role="group" aria-label="导航选择方式">
          <button
            type="button"
            className={navMode === "click" ? styles.isActive : ""}
            aria-pressed={navMode === "click"}
            onClick={() => onChangeNavMode("click")}
          >
            地图点选
          </button>
          <button
            type="button"
            className={navMode === "select" ? styles.isActive : ""}
            aria-pressed={navMode === "select"}
            onClick={() => onChangeNavMode("select")}
          >
            商铺选择
          </button>
        </div>

        {navMode === "click" && nav.phase === "idle" && (
          <button
            type="button"
            className={styles.fpNavButton}
            onClick={() => navApiRef.current?.begin()}
            disabled={navStatus !== "ready" || !stats}
          >
            {navStatus === "ready"
              ? "导航到铺位"
              : navStatus === "error"
              ? "导航不可用"
              : "正在准备导航…"}
          </button>
        )}

        {navMode === "click" && nav.phase !== "idle" && nav.phase !== "result" && (
          <div className={styles.fpNavPick}>
            <div className={styles.fpNavStatus}>
              {nav.phase === "pick-start" ? (
                "请点击起点铺位"
              ) : (
                <>
                  起点 <strong>{nav.startLabel}</strong> · 请点击终点铺位
                </>
              )}
            </div>
            <button
              type="button"
              className={styles.fpNavSecondary}
              onClick={() => navApiRef.current?.cancel()}
            >
              取消
            </button>
          </div>
        )}

        {navMode === "select" && (
          <div className={styles.fpNavSelect}>
            <Select
              size="small"
              placeholder="选择起点商铺"
              options={shopOptions(selectEnd)}
              value={selectStart ?? undefined}
              onChange={(value) => onSelectShop("start", value ?? null)}
              showSearch
              allowClear
              optionFilterProp="label"
              disabled={navStatus !== "ready"}
              notFoundContent="暂无可导航的目标"
            />
            <Select
              size="small"
              placeholder="选择终点商铺"
              options={shopOptions(selectStart)}
              value={selectEnd ?? undefined}
              onChange={(value) => onSelectShop("end", value ?? null)}
              showSearch
              allowClear
              optionFilterProp="label"
              disabled={navStatus !== "ready"}
              notFoundContent="暂无可导航的目标"
            />
            <p className={styles.fpNavSelectHint}>
              {navStatus === "ready"
                ? "已关联商户的铺位与设施均可导航"
                : navStatus === "error"
                ? "导航不可用"
                : "正在准备导航…"}
            </p>
          </div>
        )}

        {nav.phase === "result" && (
          <div>
            <div className={styles.fpRouteTitle}>
              {nav.startLabel} → {nav.endLabel}
            </div>
            <div className={styles.fpRouteMeta}>
              {numberFormat.format(Math.round(nav.distance))} m · 步行约{" "}
              {formatDuration(nav.duration)}
            </div>
            <div className={styles.fpNavActions}>
              {navMode === "select" ? (
                <button
                  type="button"
                  className={styles.fpNavButton}
                  onClick={onResetSelectRoute}
                >
                  清除路线
                </button>
              ) : (
                <>
                  <button
                    type="button"
                    className={styles.fpNavButton}
                    onClick={() => navApiRef.current?.restart()}
                  >
                    重新选择
                  </button>
                  <button
                    type="button"
                    className={styles.fpNavSecondary}
                    onClick={() => navApiRef.current?.clear()}
                  >
                    清除路线
                  </button>
                </>
              )}
            </div>
          </div>
        )}

        {nav.hint && <p className={styles.fpNavHint}>{nav.hint}</p>}
      </div>

      <div className={styles.fpActions}>
        <div className={styles.fpViewSwitch} role="group" aria-label="视图模式">
          <button
            type="button"
            className={!is3D ? styles.isActive : ""}
            aria-pressed={!is3D}
            onClick={() => onViewModeChange(false)}
            disabled={!stats}
          >
            2D
          </button>
          <button
            type="button"
            className={is3D ? styles.isActive : ""}
            aria-pressed={is3D}
            onClick={() => onViewModeChange(true)}
            disabled={!stats}
          >
            3D
          </button>
        </div>
        <button
          type="button"
          className={styles.fpFit}
          onClick={onFitAll}
          disabled={!stats}
        >
          适配全图
        </button>
      </div>

      <span className={styles.fpHint}>
        悬停高亮 · 点击查看铺位 · 支持地图点选或商铺下拉选择导航
      </span>
    </aside>
  );
}
