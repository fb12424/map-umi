import { useEffect, useRef, useState } from "react";
import {
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import {
  AREA_COLOR,
  CORRIDOR_COLOR,
  HOVER_COLOR,
  OBSTACLE_COLOR,
  OBSTACLE_OUTLINE_COLOR,
  featureBounds,
  merchantNameOf,
} from "../../lib/geoCommon.js";
import {
  AREA_TYPE,
  areaTypeOf,
  isObstacleFeature,
  labelPoint,
} from "../../lib/shopGeometry.js";
import { labelSize, renderShopLabel } from "../../lib/shopLabel.js";
import shopLabelStyles from "../../lib/shopLabel.less";

const FLOOR_SOURCE = "static-preview-floor";
const FLOOR_FILL_LAYER = "static-preview-floor-fill";
const SHOP_SOURCE = "static-preview-shops";
const SHOP_FILL_LAYER = "static-preview-shops-fill";
const SHOP_OUTLINE_LAYER = "static-preview-shops-outline";
const LABEL_MIN_ZOOM = 16.3;

// 只读楼层地图：楼板 + 铺位 + 标注 + hover 高亮，不含导航、统计和 3D
export default function useStaticMap({ shops, floor }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const hoveredRef = useRef(null);
  const [mapReady, setMapReady] = useState(false);

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: "background",
            type: "background",
            paint: { "background-color": "#eef1f6" },
          },
        ],
      },
      center: [119.30015, 26.08005],
      zoom: 18.5,
      pitch: 0,
      bearing: 0,
      minZoom: 15,
      maxZoom: 22,
      maxPitch: 0,
      touchPitch: false,
      dragRotate: false,
      pitchWithRotate: false,
    });

    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");

    if (map.isStyleLoaded()) {
      setMapReady(true);
    } else {
      map.on("load", () => setMapReady(true));
    }

    return () => {
      mapRef.current = null;
      map.remove();
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    const labels = [];
    let fitFrame = 0;

    const removeData = () => {
      for (const id of [
        SHOP_OUTLINE_LAYER,
        SHOP_FILL_LAYER,
        FLOOR_FILL_LAYER,
      ]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [SHOP_SOURCE, FLOOR_SOURCE]) {
        if (map.getSource(id)) map.removeSource(id);
      }
      for (const item of labels) item.marker.remove();
      labels.length = 0;
      hoveredRef.current = null;
    };

    removeData();

    if (!shops?.features?.length) {
      return () => removeData();
    }

    if (floor?.features?.length) {
      map.addSource(FLOOR_SOURCE, { type: "geojson", data: floor });
      map.addLayer({
        id: FLOOR_FILL_LAYER,
        type: "fill",
        source: FLOOR_SOURCE,
        paint: {
          "fill-color": CORRIDOR_COLOR,
          "fill-opacity": 1,
        },
      });
    }

    map.addSource(SHOP_SOURCE, {
      type: "geojson",
      data: shops,
      promoteId: "uid",
    });

    map.addLayer({
      id: SHOP_FILL_LAYER,
      type: "fill",
      source: SHOP_SOURCE,
      paint: {
        "fill-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          ["==", ["get", "type"], AREA_TYPE.OBSTACLE],
          OBSTACLE_COLOR,
          AREA_COLOR,
        ],
        "fill-opacity": 0.9,
      },
    });

    map.addLayer({
      id: SHOP_OUTLINE_LAYER,
      type: "line",
      source: SHOP_SOURCE,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          HOVER_COLOR,
          ["==", ["get", "type"], AREA_TYPE.OBSTACLE],
          OBSTACLE_OUTLINE_COLOR,
          "#ffffff",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "hover"], false],
          3,
          1.2,
        ],
      },
    });

    for (const feature of shops.features) {
      if (isObstacleFeature(feature.properties)) continue;

      const { uid, label, area_m2: area } = feature.properties;
      const merchantName = merchantNameOf(feature.properties);
      const type = areaTypeOf(feature.properties);
      const el = document.createElement("div");
      el.className = shopLabelStyles.shopLabel;
      renderShopLabel(el, label, merchantName, type, feature.properties.toiletType);

      const centroid = labelPoint(feature.geometry);
      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat(centroid)
        .addTo(map);

      labels.push({
        uid,
        area: area ?? 0,
        centroid,
        el,
        marker,
        ...labelSize(label, merchantName, type),
      });
    }

    const updateLabels = () => {
      if (!mapRef.current) return;
      const zoom = map.getZoom();
      const width = map.getContainer().clientWidth;
      const height = map.getContainer().clientHeight;

      if (zoom < LABEL_MIN_ZOOM) {
        for (const item of labels) item.el.style.display = "none";
        return;
      }

      const ordered = labels
        .slice()
        .sort(
          (a, b) =>
            Number(b.uid === hoveredRef.current) -
              Number(a.uid === hoveredRef.current) || b.area - a.area,
        );
      const placed = [];

      for (const item of ordered) {
        const point = map.project(item.centroid);
        const left = point.x - item.width / 2 - 2;
        const top = point.y - item.height / 2 - 2;
        const right = left + item.width + 4;
        const bottom = top + item.height + 4;

        let visible = right > 0 && left < width && bottom > 0 && top < height;

        if (visible) {
          for (const box of placed) {
            if (
              left < box.right &&
              right > box.left &&
              top < box.bottom &&
              bottom > box.top
            ) {
              visible = false;
              break;
            }
          }
        }

        item.el.style.display = visible ? "" : "none";
        if (visible) placed.push({ left, right, top, bottom });
        item.el.classList.toggle(
          shopLabelStyles.isActive,
          item.uid === hoveredRef.current,
        );
      }
    };

    const setHover = (uid) => {
      if (uid === hoveredRef.current) return;
      if (hoveredRef.current) {
        map.setFeatureState(
          { source: SHOP_SOURCE, id: hoveredRef.current },
          { hover: false },
        );
      }
      hoveredRef.current = uid;
      if (uid) {
        map.setFeatureState({ source: SHOP_SOURCE, id: uid }, { hover: true });
      }
      updateLabels();
    };

    const pickFeatureAt = (point) => {
      const [top] = map.queryRenderedFeatures(point, {
        layers: [SHOP_FILL_LAYER],
      });
      return top && !isObstacleFeature(top.properties) ? top : null;
    };

    const onMouseMove = (event) => {
      const feature = pickFeatureAt(event.point);
      setHover(feature ? feature.properties.uid : null);
    };

    const onMouseOut = () => setHover(null);

    map.on("move", updateLabels);
    map.on("resize", updateLabels);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);

    const bounds = featureBounds(
      floor?.features?.length
        ? [...shops.features, ...floor.features]
        : shops.features,
    );
    fitFrame = requestAnimationFrame(() => {
      const camera = map.cameraForBounds(bounds, {
        padding: 48,
        maxZoom: 20,
      });
      if (!camera) return;
      map.easeTo({
        center: camera.center,
        zoom: camera.zoom,
        pitch: 0,
        bearing: 0,
        duration: 0,
      });
    });

    map.once("idle", updateLabels);
    updateLabels();

    return () => {
      if (mapRef.current !== map) return;
      cancelAnimationFrame(fitFrame);
      map.off("move", updateLabels);
      map.off("resize", updateLabels);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("idle", updateLabels);
      removeData();
    };
  }, [shops, floor, mapReady]);

  return { containerRef };
}
