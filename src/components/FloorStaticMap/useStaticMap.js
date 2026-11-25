import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
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
  facilityKindsOf,
  isFacilityType,
  isObstacleFeature,
  labelPoint,
} from "../../lib/shopGeometry.js";
import { measureRoute, routeDotSamples } from "../../lib/routeFlow.js";
import { labelSize, renderShopLabel } from "../../lib/shopLabel.js";
import shopLabelStyles from "../../lib/shopLabel.less";
import pinStyles from "./FloorStaticMap.less";

const FLOOR_SOURCE = "static-preview-floor";
const FLOOR_FILL_LAYER = "static-preview-floor-fill";
const SHOP_SOURCE = "static-preview-shops";
const SHOP_FILL_LAYER = "static-preview-shops-fill";
const SHOP_OUTLINE_LAYER = "static-preview-shops-outline";
const ROUTE_SOURCE = "static-nav-route";
const ROUTE_CASING_LAYER = "static-nav-route-casing";
const ROUTE_LINE_LAYER = "static-nav-route-line";
const ROUTE_DOT_SOURCE = "static-nav-route-dots";
const ROUTE_DOT_LAYER = "static-nav-route-dots-layer";
const LABEL_MIN_ZOOM = 16.3;
const NAV_ROUTE_COLOR = "#0f766e";

// 只读楼层地图：楼板 + 铺位 + 标注 + hover 高亮，不含导航、统计和 3D
export default function useStaticMap({
  shops,
  floor,
  route = null,
  pins = [],
  fitPaddingBottom = 0,
}) {
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
    const pinMarkers = [];
    let fitFrame = 0;

    const removeData = () => {
      for (const id of [
        ROUTE_DOT_LAYER,
        SHOP_OUTLINE_LAYER,
        SHOP_FILL_LAYER,
        FLOOR_FILL_LAYER,
        ROUTE_CASING_LAYER,
        ROUTE_LINE_LAYER,
      ]) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [
        ROUTE_DOT_SOURCE,
        SHOP_SOURCE,
        FLOOR_SOURCE,
        ROUTE_SOURCE,
      ]) {
        if (map.getSource(id)) map.removeSource(id);
      }
      for (const item of labels) item.marker.remove();
      labels.length = 0;
      for (const marker of pinMarkers) marker.remove();
      pinMarkers.length = 0;
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
      const facilityKinds = facilityKindsOf(feature.properties);
      const el = document.createElement("div");
      el.className = shopLabelStyles.shopLabel;
      renderShopLabel(
        el,
        label,
        merchantName,
        type,
        facilityKinds,
        feature.properties.toiletType,
      );

      const centroid = labelPoint(feature.geometry);
      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat(centroid)
        .addTo(map);

      labels.push({
        uid,
        area: area ?? 0,
        type,
        centroid,
        el,
        marker,
        ...labelSize(label, merchantName, type, facilityKinds),
      });
    }

    map.addSource(ROUTE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: ROUTE_CASING_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": "#ffffff", "line-width": 8, "line-opacity": 0.95 },
    });
    map.addLayer({
      id: ROUTE_LINE_LAYER,
      type: "line",
      source: ROUTE_SOURCE,
      layout: { "line-cap": "round", "line-join": "round" },
      paint: { "line-color": NAV_ROUTE_COLOR, "line-width": 4.5 },
    });

    map.addSource(ROUTE_DOT_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: ROUTE_DOT_LAYER,
      type: "circle",
      source: ROUTE_DOT_SOURCE,
      paint: {
        "circle-radius": 4.5,
        "circle-color": "#fff",
      },
    });

    if (route?.length) {
      map.getSource(ROUTE_SOURCE)?.setData({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: { type: "LineString", coordinates: route },
            properties: {},
          },
        ],
      });
    }

    // 圆点沿路线匀速前进并从起点回绕，形成循环流动效果
    const routeMetrics = route?.length ? measureRoute(route) : null;
    let dotFrame = 0;
    let dotAt = 0;
    let dotTraveled = 0;

    const pushDotFrame = () => {
      if (!routeMetrics) return;
      const features = routeDotSamples(routeMetrics, dotTraveled).map(
        (coordinates) => ({
          type: "Feature",
          geometry: { type: "Point", coordinates },
          properties: {},
        }),
      );
      map.getSource(ROUTE_DOT_SOURCE)?.setData({
        type: "FeatureCollection",
        features,
      });
    };

    if (routeMetrics) {
      const speed = Math.min(Math.max(routeMetrics.total / 5, 6), 20); // 米/秒
      pushDotFrame();
      const animateDots = (timestamp) => {
        dotFrame = requestAnimationFrame(animateDots);
        if (!dotAt) {
          dotAt = timestamp;
          return;
        }
        // 约 25fps 刷新一次，低配机器上不跟屏幕刷新率抢 geojson 重建
        const delta = Math.min(timestamp - dotAt, 120);
        if (delta < 40) return;
        dotAt = timestamp;
        dotTraveled += (delta / 1000) * speed;
        pushDotFrame();
      };
      dotFrame = requestAnimationFrame(animateDots);
    }

    for (const pin of pins ?? []) {
      const el = document.createElement("div");
      el.className = `${pinStyles.pin} ${pinStyles[pin.type] || ""}`;
      el.textContent =
        pin.type === "start" ? "起" : pin.type === "end" ? "终" : "梯";
      pinMarkers.push(
        new Marker({ element: el, anchor: "center" })
          .setLngLat(pin.lngLat)
          .addTo(map),
      );
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

      const ordered = labels.slice().sort(
        (a, b) =>
          Number(b.uid === hoveredRef.current) -
            Number(a.uid === hoveredRef.current) ||
          // 设施图标是导航地标，面积通常很小；先排它们，避免被大铺位标注挤掉
          Number(isFacilityType(b.type)) - Number(isFacilityType(a.type)) ||
          b.area - a.area,
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

    const routeCoords = route?.length ? route : null;
    let bounds;
    if (routeCoords) {
      bounds = new LngLatBounds();
      for (const coordinate of routeCoords) bounds.extend(coordinate);
      for (const pin of pins ?? []) bounds.extend(pin.lngLat);
    } else {
      bounds = featureBounds(
        floor?.features?.length
          ? [...shops.features, ...floor.features]
          : shops.features,
      );
    }
    const fitPadding = routeCoords
      ? { top: 48, right: 48, bottom: 48 + (fitPaddingBottom ?? 0), left: 48 }
      : 48;
    fitFrame = requestAnimationFrame(() => {
      const camera = map.cameraForBounds(bounds, {
        padding: fitPadding,
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
      cancelAnimationFrame(dotFrame);
      map.off("move", updateLabels);
      map.off("resize", updateLabels);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("idle", updateLabels);
      removeData();
    };
  }, [shops, floor, mapReady, route, pins, fitPaddingBottom]);

  return { containerRef };
}

