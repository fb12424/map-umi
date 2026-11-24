import useEditPreview from "./useEditPreview.js";
import styles from "./FloorEditPreview.less";

// 纯展示壳：地图、标注、交互逻辑全部在 useEditPreview 里，
// 这里只负责挂载容器、渲染统计卡和工具栏，所以组件本身没有状态。
export default function FloorEditPreview({
  geojson,
  floor = null,
  fitKey,
  activeUid = null,
  linkedUid = null,
  showUnnumberedIndex = false,
  onShopClick,
  onFloorReady,
}) {
  const { containerRef, stats, fitAll } = useEditPreview({
    geojson,
    floor,
    fitKey,
    activeUid,
    linkedUid,
    showUnnumberedIndex,
    onShopClick,
    onFloorReady,
  });

  return (
    <div className={styles.previewMapWrap}>
      <div ref={containerRef} className={styles.previewMap} />

      {stats && (
        <div className={styles.previewMapSummary}>
          <div>
            <strong>{stats.count}</strong> 间铺位
            {stats.facilityCount ? ` · ${stats.facilityCount} 个设施` : ""}
            {stats.obstacleCount ? ` · ${stats.obstacleCount} 个障碍区` : ""}
          </div>
          <div className={styles.previewMapCodeStats}>
            <span>
              正常位号 <strong>{stats.normal}</strong>
            </span>
            <span className={stats.missing ? styles.isWarning : ""}>
              无位号 <strong>{stats.missing}</strong>
            </span>
            <span className={stats.duplicate ? styles.isDanger : ""}>
              重复位号{" "}
              {stats.duplicate ? (
                <>
                  <strong>{stats.duplicate}</strong> 种 /{" "}
                  <strong>{stats.duplicateShops}</strong> 间
                </>
              ) : (
                <strong>0</strong>
              )}
            </span>
          </div>
          {/* 有重复位号时才出现图例，避免正常情况下多一行干扰信息 */}
          {stats.duplicate > 0 && (
            <div className={styles.previewMapLegend}>
              <i aria-hidden="true" />
              红色铺位为重复位号
            </div>
          )}
        </div>
      )}

      {/* 工具栏独立于地图控件，fitAll 是 Hook 里保存下来的闭包 */}
      <div className={styles.previewMapToolbar}>
        <button type="button" className={styles.previewFit} onClick={fitAll}>
          适配全图
        </button>
      </div>
    </div>
  );
}
