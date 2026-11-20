import useEditPreview from "./useEditPreview.js";
import "./FloorEditPreview.css";

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
          </div>
          <div className="preview-map-code-stats">
            <span>
              正常位号 <strong>{stats.normal}</strong>
            </span>
            <span className={stats.missing ? "is-warning" : ""}>
              无位号 <strong>{stats.missing}</strong>
            </span>
            <span className={stats.duplicate ? "is-danger" : ""}>
              重复位号 <strong>{stats.duplicate}</strong>
            </span>
          </div>
          {stats.duplicate > 0 && (
            <div className="preview-map-legend">
              <i aria-hidden="true" />
              红色铺位为重复位号
            </div>
          )}
        </div>
      )}

      <div className="preview-map-toolbar">
        <button type="button" className="preview-fit" onClick={fitAll}>
          适配全图
        </button>
      </div>
    </div>
  );
}
