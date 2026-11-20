import NavPanel from "./NavPanel.jsx";
import { merchantNameOf } from "../../lib/geoCommon.js";
import { isMerchantLinked, merchantNoOf } from "./previewCore.js";
import useGuideMap from "./useGuideMap.js";
import "./FloorGuideMap.css";

export default function FloorGuideMap({ shops, floor }) {
  const {
    containerRef,
    panelRef,
    stats,
    navStatus,
    navMode,
    nav,
    is3D,
    selectStart,
    selectEnd,
    navApiRef,
    setViewMode,
    changeNavMode,
    handleSelectShop,
    resetSelectRoute,
    fitAll,
  } = useGuideMap({ shops, floor });

  const linkedShops = (shops?.features ?? [])
    .filter((feature) => isMerchantLinked(feature.properties ?? {}))
    .map((feature) => {
      const props = feature.properties;
      const merchant = merchantNameOf(props) || merchantNoOf(props);
      return {
        uid: props.uid,
        label: props.label,
        text: `${props.label} · ${merchant}`,
      };
    })
    .sort((a, b) => a.label.localeCompare(b.label, "zh-CN", { numeric: true }));

  const shopOptions = (excludeUid) =>
    linkedShops
      .filter((item) => item.uid !== excludeUid)
      .map(({ uid, text }) => ({ value: uid, label: text }));

  return (
    <div className="fp-map-wrap">
      <div ref={containerRef} className="fp-map" />

      <NavPanel
        panelRef={panelRef}
        stats={stats}
        navStatus={navStatus}
        navMode={navMode}
        nav={nav}
        is3D={is3D}
        selectStart={selectStart}
        selectEnd={selectEnd}
        shopOptions={shopOptions}
        navApiRef={navApiRef}
        onChangeNavMode={changeNavMode}
        onSelectShop={handleSelectShop}
        onResetSelectRoute={resetSelectRoute}
        onViewModeChange={setViewMode}
        onFitAll={fitAll}
      />
    </div>
  );
}
