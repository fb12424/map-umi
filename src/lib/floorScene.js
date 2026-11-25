import { deriveFloorFromShops } from "./floorGeometry.js";
import { normalizeShopData } from "./shopGeometry.js";
import { getMap, getMapGeoJson, getMapOutline } from "../services/maps.js";

function isValidOutline(value) {
  return (
    value?.type === "FeatureCollection" &&
    Array.isArray(value.features) &&
    value.features.length > 0
  );
}

export async function loadFloorScene(floorId) {
  const [meta, raw, savedOutline] = await Promise.all([
    getMap(floorId),
    getMapGeoJson(floorId),
    getMapOutline(floorId).catch(() => null),
  ]);

  const shops = normalizeShopData(raw);
  let floor = isValidOutline(savedOutline) ? savedOutline : null;
  if (!floor) {
    try {
      floor = deriveFloorFromShops(shops.features);
    } catch (err) {
      console.warn("楼层轮廓派生失败，仅显示商铺", err);
    }
  }

  return { meta, shops, floor };
}
