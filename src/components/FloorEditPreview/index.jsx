import useEditPreview from "./useEditPreview.js";
import "./FloorEditPreview.css";

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
    <div className="preview-map-wrap">
      <div ref={containerRef} className="preview-map" />

      {stats && (
        <div className="preview-map-summary">
          <div>
            <strong>{stats.count}</strong> 间铺位
            {stats.facilityCount ? ` · ${stats.facilityCount} 个设施` : ""}
            {stats.obstacleCount ? ` · ${stats.obstacleCount} 个障碍区` : ""}
          </div>
          <div className="preview-map-code-stats">
            <span>
              正常位号 <strong>{stats.normal}</strong>
            </span>
            <span className={stats.missing ? "is-warning" : ""}>
              无位号 <strong>{stats.missing}</strong>
            </span>
            <span className={stats.duplicate ? "is-danger" : ""}>
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
            <div className="preview-map-legend">
              <i aria-hidden="true" />
              红色铺位为重复位号
            </div>
          )}
        </div>
      )}

      {/* 工具栏独立于地图控件，fitAll 是 Hook 里保存下来的闭包 */}
      <div className="preview-map-toolbar">
        <button type="button" className="preview-fit" onClick={fitAll}>
          适配全图
        </button>
      </div>
    </div>
  );
}
