import NavPanel from "./NavPanel.jsx";
import { merchantNameOf } from "../../lib/geoCommon.js";
import { AREA_TYPE, areaTypeOf } from "../../lib/shopGeometry.js";
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

  // 导航目的地：已关联商户的商铺 + 全部设施（电梯/厕所/母婴），设施用名称作为文案；
  // 障碍区既不是目的地，也不出现在下拉列表里
  const linkedShops = (shops?.features ?? [])
    .map((feature) => {
      const props = feature.properties ?? {};
      const type = areaTypeOf(props);
      if (type === AREA_TYPE.OBSTACLE) return null;
      if (type !== AREA_TYPE.SHOP) {
        return { uid: props.uid, label: props.label, text: props.label };
      }
      if (!isMerchantLinked(props)) return null;
      const merchant = merchantNameOf(props) || merchantNoOf(props);
      return {
        uid: props.uid,
        label: props.label,
        text: `${props.label} · ${merchant}`,
      };
    })
    .filter(Boolean)
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
