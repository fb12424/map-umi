import { useEffect, useRef, useState } from "react";
import {
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
  Popup,
  ScaleControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { DEFAULT_BUFFER_METERS } from "../../lib/floorGeometry.js";
import { featureBounds, merchantNameOf } from "../../lib/geoCommon.js";
import { buildNavGrid, findRoute } from "../../lib/routing.js";
import { labelPoint } from "../../lib/shopGeometry.js";
import {
  ALL_LAYERS,
  ALL_SOURCES,
  BEARING_3D,
  CORRIDOR_COLOR_2D,
  CORRIDOR_COLOR_3D,
  EXTRUSION_COLOR,
  FILL_COLOR,
  FILL_LAYER,
  FLOOR_EXTRUSION_LAYER,
  FLOOR_FILL_LAYER,
  FLOOR_HEIGHT,
  FLOOR_SOURCE,
  LABEL_MIN_ZOOM,
  NAV_LINE_LAYERS,
  NAV_ROUTE_CASING_LAYER,
  NAV_ROUTE_COLOR,
  NAV_ROUTE_HALF_WIDTH,
  NAV_ROUTE_LINE_LAYER,
  NAV_ROUTE_RIBBON_LAYER,
  NAV_ROUTE_SOURCE,
  OUTLINE_LAYER,
  PITCH_3D,
  PITCH_ZOOM_BOOST,
  SELECTED_SHOP_HEIGHT,
  SHOP_HEIGHT,
  SHOPS_EXTRUSION_LAYER,
  SOURCE_ID,
  buildPopupContent,
  labelSize,
  merchantNoOf,
  renderLabel,
} from "./previewCore.js";

export default function useGuideMap({ shops, floor }) {
  const containerRef = useRef(null);
  const panelRef = useRef(null);
  const mapRef = useRef(null);
  const fitBoundsRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const popupRef = useRef(null);
  const is3DRef = useRef(false);
  const navGridRef = useRef(null);
  const navRef = useRef({ phase: "idle", startUid: null, endUid: null });
  const navMarkersRef = useRef([]);
  const navApiRef = useRef(null);
  const navModeRef = useRef("click");

  const [is3D, setIs3D] = useState(false);
  const [mapReady, setMapReady] = useState(false);
  const [stats, setStats] = useState(null);
  const [navStatus, setNavStatus] = useState("loading");
  const [navMode, setNavMode] = useState("click");
  const [selectStart, setSelectStart] = useState(null);
  const [selectEnd, setSelectEnd] = useState(null);
  const [nav, setNav] = useState({
    phase: "idle",
    startLabel: "",
    endLabel: "",
    distance: 0,
    duration: 0,
    hint: "",
  });

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
      maxPitch: 70,
      dragRotate: true,
      pitchWithRotate: true,
    });

    mapRef.current = map;
    map.addControl(
      new NavigationControl({ showCompass: true, visualizePitch: true }),
      "top-right",
    );
    map.addControl(
      new ScaleControl({ maxWidth: 120, unit: "metric" }),
      "bottom-left",
    );

    if (map.isStyleLoaded()) {
      setMapReady(true);
    } else {
      map.on("load", () => setMapReady(true));
    }

    return () => {
      mapRef.current = null;
      map.remove();
      popupRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    navModeRef.current = "click";
    setNavMode("click");
    setSelectStart(null);
    setSelectEnd(null);
  }, [shops, floor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    let cancelled = false;
    let fitTimer = 0;
    let navBuildTimer = 0;
    const labels = [];

    const removeData = () => {
      for (const id of ALL_LAYERS) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of ALL_SOURCES) {
        if (map.getSource(id)) map.removeSource(id);
      }
      for (const item of labels) item.marker.remove();
      labels.length = 0;
      hoveredRef.current = null;
      selectedRef.current = null;
      for (const marker of navMarkersRef.current) marker.remove();
      navMarkersRef.current = [];
    };

    removeData();
    setStats(null);
    setNavStatus("loading");
    setNav({
      phase: "idle",
      startLabel: "",
      endLabel: "",
      distance: 0,
      duration: 0,
      hint: "",
    });
    navRef.current = { phase: "idle", startUid: null, endUid: null };
    navGridRef.current = null;
    navApiRef.current = null;
    popupRef.current?.remove();
    popupRef.current = null;

    if (!shops?.features?.length) {
      setNavStatus("error");
      return () => removeData();
    }

    const threeD = is3DRef.current;

    if (floor?.features?.length) {
      map.addSource(FLOOR_SOURCE, { type: "geojson", data: floor });
      map.addLayer({
        id: FLOOR_FILL_LAYER,
        type: "fill",
        source: FLOOR_SOURCE,
        layout: { visibility: threeD ? "none" : "visible" },
        paint: {
          "fill-color": CORRIDOR_COLOR_2D,
          "fill-opacity": 1,
        },
      });
      map.addLayer({
        id: FLOOR_EXTRUSION_LAYER,
        type: "fill-extrusion",
        source: FLOOR_SOURCE,
        layout: { visibility: threeD ? "visible" : "none" },
        paint: {
          "fill-extrusion-color": CORRIDOR_COLOR_3D,
          "fill-extrusion-height": FLOOR_HEIGHT,
          "fill-extrusion-base": 0,
          "fill-extrusion-opacity": 1,
          "fill-extrusion-vertical-gradient": true,
        },
      });
    }

    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: shops,
      promoteId: "uid",
    });

    map.addLayer({
      id: FILL_LAYER,
      type: "fill",
      source: SOURCE_ID,
      layout: { visibility: threeD ? "none" : "visible" },
      paint: {
        "fill-color": FILL_COLOR,
        "fill-opacity": 0.9,
      },
    });

    map.addLayer({
      id: OUTLINE_LAYER,
      type: "line",
      source: SOURCE_ID,
      layout: { visibility: threeD ? "none" : "visible" },
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "start"], false],
          "#16a34a",
          ["boolean", ["feature-state", "end"], false],
          "#dc2626",
          ["boolean", ["feature-state", "selected"], false],
          "#2563eb",
          ["boolean", ["feature-state", "hover"], false],
          "#f97316",
          "#ffffff",
        ],
        "line-width": [
          "case",
          [
            "any",
            ["boolean", ["feature-state", "start"], false],
            ["boolean", ["feature-state", "end"], false],
            ["boolean", ["feature-state", "selected"], false],
            ["boolean", ["feature-state", "hover"], false],
          ],
          3,
          1.2,
        ],
      },
    });

    map.addLayer({
      id: SHOPS_EXTRUSION_LAYER,
      type: "fill-extrusion",
      source: SOURCE_ID,
      layout: { visibility: threeD ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": EXTRUSION_COLOR,
        "fill-extrusion-base": FLOOR_HEIGHT,
        "fill-extrusion-height": [
          "case",
          [
            "any",
            ["boolean", ["feature-state", "start"], false],
            ["boolean", ["feature-state", "end"], false],
            ["boolean", ["feature-state", "selected"], false],
          ],
          SELECTED_SHOP_HEIGHT,
          SHOP_HEIGHT,
        ],
        "fill-extrusion-opacity": 1,
        "fill-extrusion-vertical-gradient": true,
      },
    });

    map.addSource(NAV_ROUTE_SOURCE, {
      type: "geojson",
      data: { type: "FeatureCollection", features: [] },
    });
    map.addLayer({
      id: NAV_ROUTE_CASING_LAYER,
      type: "line",
      source: NAV_ROUTE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: {
        visibility: threeD ? "none" : "visible",
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": "#ffffff",
        "line-width": 8,
        "line-opacity": 0.95,
      },
    });
    map.addLayer({
      id: NAV_ROUTE_LINE_LAYER,
      type: "line",
      source: NAV_ROUTE_SOURCE,
      filter: ["==", ["geometry-type"], "LineString"],
      layout: {
        visibility: threeD ? "none" : "visible",
        "line-cap": "round",
        "line-join": "round",
      },
      paint: {
        "line-color": NAV_ROUTE_COLOR,
        "line-width": 4.5,
      },
    });
    map.addLayer({
      id: NAV_ROUTE_RIBBON_LAYER,
      type: "fill-extrusion",
      source: NAV_ROUTE_SOURCE,
      filter: ["==", ["geometry-type"], "Polygon"],
      layout: { visibility: threeD ? "visible" : "none" },
      paint: {
        "fill-extrusion-color": NAV_ROUTE_COLOR,
        "fill-extrusion-base": FLOOR_HEIGHT + 0.02,
        "fill-extrusion-height": FLOOR_HEIGHT + 0.09,
        "fill-extrusion-opacity": 0.95,
      },
    });

    let totalArea = 0;
    for (const feature of shops.features) {
      const { uid, label, area_m2: area } = feature.properties;
      totalArea += area;

      const merchantName = merchantNameOf(feature.properties);
      const text = label;
      const el = document.createElement("div");
      el.className = "fp-shop-label";
      renderLabel(el, text, merchantName);

      const centroid = labelPoint(feature.geometry);
      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat(centroid)
        .addTo(map);

      labels.push({
        uid,
        label,
        area,
        centroid,
        el,
        marker,
        merchantName,
        merchantLabel: merchantName || merchantNoOf(feature.properties),
        ...labelSize(text, merchantName),
      });
    }

    setStats({ count: shops.features.length, totalArea });

    const fitPadding = () => {
      const width = map.getContainer().clientWidth;
      const height = map.getContainer().clientHeight;
      const panel = panelRef.current?.getBoundingClientRect();
      const sidePanel = panel && panel.width < width * 0.6;
      if (sidePanel) {
        return {
          top: 72,
          right: 72,
          bottom: 72,
          left: Math.min(width * 0.55, panel.width + 40),
        };
      }
      return {
        top: Math.min((panel?.height ?? 220) + 28, height * 0.5),
        right: 40,
        bottom: 48,
        left: 40,
      };
    };

    const updateLabels = () => {
      if (!mapRef.current) return;
      const zoom = map.getZoom();
      const width = map.getContainer().clientWidth;
      const height = map.getContainer().clientHeight;

      if (zoom < LABEL_MIN_ZOOM) {
        for (const item of labels) item.el.style.display = "none";
        return;
      }

      const rank = (uid) => {
        if (uid === navRef.current.startUid) return 4;
        if (uid === navRef.current.endUid) return 3;
        if (uid === selectedRef.current) return 2;
        if (uid === hoveredRef.current) return 1;
        return 0;
      };
      const ordered = labels
        .slice()
        .sort((a, b) => rank(b.uid) - rank(a.uid) || b.area - a.area);
      const placed = [];

      for (const item of ordered) {
        const point = map.project(item.centroid);
        const boxWidth = item.width;
        const boxHeight = item.height;
        const left = point.x - boxWidth / 2 - 2;
        const top = point.y - boxHeight / 2 - 2;
        const right = left + boxWidth + 4;
        const bottom = top + boxHeight + 4;

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
          "is-active",
          item.uid === selectedRef.current || item.uid === hoveredRef.current,
        );
        item.el.classList.toggle("is-start", item.uid === navRef.current.startUid);
        item.el.classList.toggle("is-end", item.uid === navRef.current.endUid);
      }
    };

    const clearSelection = () => {
      if (selectedRef.current) {
        map.setFeatureState(
          { source: SOURCE_ID, id: selectedRef.current },
          { selected: false },
        );
      }
      selectedRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
    };

    const setHover = (id) => {
      if (id === hoveredRef.current) return;
      if (hoveredRef.current) {
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredRef.current },
          { hover: false },
        );
      }
      hoveredRef.current = id;
      if (id) {
        map.setFeatureState({ source: SOURCE_ID, id }, { hover: true });
      }
      map.getCanvas().style.cursor = id ? "pointer" : "";
      updateLabels();
    };

    const updateNavUI = (patch) => setNav((prev) => ({ ...prev, ...patch }));

    const setNavFeatureState = (uid, key, value) => {
      if (!uid) return;
      map.setFeatureState({ source: SOURCE_ID, id: uid }, { [key]: value });
    };

    const clearNavMarkers = () => {
      for (const marker of navMarkersRef.current) marker.remove();
      navMarkersRef.current = [];
    };

    const clearNavRoute = () => {
      map
        .getSource(NAV_ROUTE_SOURCE)
        ?.setData({ type: "FeatureCollection", features: [] });
      clearNavMarkers();
    };

    const clearNavSelection = () => {
      const { startUid, endUid } = navRef.current;
      setNavFeatureState(startUid, "start", false);
      setNavFeatureState(endUid, "end", false);
      navRef.current = { phase: "idle", startUid: null, endUid: null };
      clearNavRoute();
      updateNavUI({
        phase: "idle",
        startLabel: "",
        endLabel: "",
        distance: 0,
        duration: 0,
        hint: "",
      });
      updateLabels();
    };

    const beginNav = () => {
      if (!navGridRef.current) return;
      popupRef.current?.remove();
      popupRef.current = null;
      clearSelection();
      clearNavSelection();
      navRef.current = { phase: "pick-start", startUid: null, endUid: null };
      updateNavUI({
        phase: "pick-start",
        startLabel: "",
        endLabel: "",
        distance: 0,
        duration: 0,
        hint: "",
      });
      updateLabels();
    };

    const addNavPin = (lngLat, type) => {
      const el = document.createElement("div");
      el.className = `fp-nav-pin fp-nav-pin-${type}`;
      el.textContent = type === "start" ? "起" : "终";
      const marker = new Marker({
        element: el,
        anchor: "center",
        offset: [0, -20],
      })
        .setLngLat(lngLat)
        .addTo(map);
      navMarkersRef.current.push(marker);
    };

    const fitRoute = (coordinates) => {
      const routeBounds = new LngLatBounds();
      for (const coordinate of coordinates) routeBounds.extend(coordinate);
      const threeDView = is3DRef.current;
      const camera = map.cameraForBounds(routeBounds, {
        padding: fitPadding(),
        maxZoom: 20,
        pitch: threeDView ? PITCH_3D : 0,
        bearing: threeDView ? BEARING_3D : 0,
      });
      if (!camera) return;
      map.easeTo({
        center: camera.center,
        zoom: camera.zoom + (threeDView ? PITCH_ZOOM_BOOST : 0),
        pitch: threeDView ? PITCH_3D : 0,
        bearing: threeDView ? BEARING_3D : 0,
        duration: 650,
      });
    };

    const describeShop = (meta) =>
      meta.merchantLabel ? `${meta.label} · ${meta.merchantLabel}` : meta.label;

    const applyRoute = (startUid, endUid) => {
      const startMeta = labels.find((item) => item.uid === startUid);
      const endMeta = labels.find((item) => item.uid === endUid);
      if (!startMeta || !endMeta) throw new Error("铺位数据缺失，请重新选择");

      const route = findRoute(navGridRef.current, startMeta.centroid, endMeta.centroid, {
        halfWidth: NAV_ROUTE_HALF_WIDTH,
      });

      setNavFeatureState(startUid, "start", true);
      setNavFeatureState(endUid, "end", true);
      navRef.current = { phase: "result", startUid, endUid };

      const features = [
        {
          type: "Feature",
          geometry: { type: "LineString", coordinates: route.coordinates },
          properties: {},
        },
      ];
      if (route.ribbon) {
        features.push({
          type: "Feature",
          geometry: { type: "Polygon", coordinates: [route.ribbon] },
          properties: {},
        });
      }
      map
        .getSource(NAV_ROUTE_SOURCE)
        ?.setData({ type: "FeatureCollection", features });

      clearNavMarkers();
      addNavPin(route.startPoint, "start");
      addNavPin(route.endPoint, "end");

      updateNavUI({
        phase: "result",
        startLabel: describeShop(startMeta),
        endLabel: describeShop(endMeta),
        distance: route.distance,
        duration: route.duration,
        hint: "",
      });
      fitRoute(route.coordinates);
      updateLabels();
    };

    const routeByUid = (startUid, endUid) => {
      popupRef.current?.remove();
      popupRef.current = null;
      clearSelection();
      clearNavSelection();

      if (!startUid || !endUid) return;
      if (startUid === endUid) {
        updateNavUI({ hint: "起点和终点不能是同一个铺位" });
        return;
      }

      try {
        applyRoute(startUid, endUid);
      } catch (err) {
        updateNavUI({ hint: err.message || "无法生成路线" });
      }
    };

    const handleNavPick = (uid) => {
      const meta = labels.find((item) => item.uid === uid);
      if (!meta) return;

      if (navRef.current.phase === "pick-start") {
        setNavFeatureState(uid, "start", true);
        navRef.current.startUid = uid;
        navRef.current.phase = "pick-end";
        updateNavUI({
          phase: "pick-end",
          startLabel: describeShop(meta),
          hint: "",
        });
        updateLabels();
        return;
      }

      if (navRef.current.phase !== "pick-end") return;
      if (uid === navRef.current.startUid) {
        updateNavUI({ hint: "起点和终点不能是同一个铺位" });
        return;
      }

      try {
        applyRoute(navRef.current.startUid, uid);
      } catch (err) {
        updateNavUI({ hint: err.message || "无法生成路线" });
      }
    };

    navApiRef.current = {
      begin: beginNav,
      cancel: clearNavSelection,
      restart: beginNav,
      clear: clearNavSelection,
      routeByUid,
    };

    const bounds = featureBounds(shops.features);
    const fit = (duration) => {
      map.resize();
      const threeDView = is3DRef.current;
      const camera = map.cameraForBounds(bounds, {
        padding: fitPadding(),
        maxZoom: 20,
        pitch: threeDView ? PITCH_3D : 0,
        bearing: threeDView ? BEARING_3D : 0,
      });
      if (!camera) return;
      map.easeTo({
        center: camera.center,
        zoom: camera.zoom + (threeDView ? PITCH_ZOOM_BOOST : 0),
        pitch: threeDView ? PITCH_3D : 0,
        bearing: threeDView ? BEARING_3D : 0,
        duration,
      });
    };
    fitBoundsRef.current = () => fit(650);

    const onMouseMove = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER, SHOPS_EXTRUSION_LAYER],
      });
      setHover(features.length ? features[0].properties.uid : null);
    };

    const onMouseOut = () => setHover(null);

    const onClick = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER, SHOPS_EXTRUSION_LAYER],
      });

      if (navModeRef.current === "click" && navRef.current.phase !== "idle") {
        if (!features.length) {
          if (
            navRef.current.phase === "pick-start" ||
            navRef.current.phase === "pick-end"
          ) {
            updateNavUI({ hint: "请点击铺位" });
          }
          return;
        }
        handleNavPick(features[0].properties.uid);
        return;
      }

      if (!features.length) {
        clearSelection();
        updateLabels();
        return;
      }

      const props = features[0].properties;
      const { uid } = props;
      if (selectedRef.current && selectedRef.current !== uid) {
        map.setFeatureState(
          { source: SOURCE_ID, id: selectedRef.current },
          { selected: false },
        );
      }
      selectedRef.current = uid;
      map.setFeatureState({ source: SOURCE_ID, id: uid }, { selected: true });

      popupRef.current?.remove();
      const panelBottom = panelRef.current?.getBoundingClientRect().bottom ?? 0;
      const anchor = event.point.y < panelBottom + 80 ? "top" : "bottom";
      popupRef.current = new Popup({
        closeButton: false,
        offset: 14,
        maxWidth: "240px",
        className: "fp-popup",
        anchor,
      })
        .setLngLat(event.lngLat)
        .setDOMContent(buildPopupContent(props))
        .addTo(map);
      updateLabels();
    };

    map.on("move", updateLabels);
    map.on("resize", updateLabels);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("click", onClick);

    fitTimer = window.setTimeout(() => fit(0), 0);

    navBuildTimer = window.setTimeout(() => {
      if (cancelled) return;
      if (!floor?.features?.length) {
        setNavStatus("error");
        return;
      }
      try {
        navGridRef.current = buildNavGrid(shops.features, floor, {
          cellSize: 0.5,
          exteriorMargin: DEFAULT_BUFFER_METERS,
        });
        setNavStatus("ready");
      } catch (err) {
        console.error("导航区域构建失败", err);
        setNavStatus("error");
      }
    }, 80);

    map.once("idle", updateLabels);
    updateLabels();

    return () => {
      cancelled = true;
      window.clearTimeout(navBuildTimer);
      window.clearTimeout(fitTimer);
      map.off("move", updateLabels);
      map.off("resize", updateLabels);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("click", onClick);
      map.off("idle", updateLabels);
      fitBoundsRef.current = null;
      navApiRef.current = null;
      navGridRef.current = null;
      popupRef.current?.remove();
      popupRef.current = null;
      // 组件卸载时 map 已被移除，此时再访问图层会抛错
      if (mapRef.current === map) removeData();
    };
  }, [shops, floor, mapReady]);

  const setViewMode = (next) => {
    is3DRef.current = next;
    setIs3D(next);

    const map = mapRef.current;
    if (!map) return;

    const setVisibility = (ids, visible) => {
      for (const id of ids) {
        if (map.getLayer(id)) {
          map.setLayoutProperty(id, "visibility", visible ? "visible" : "none");
        }
      }
    };

    setVisibility([FLOOR_FILL_LAYER, FILL_LAYER, OUTLINE_LAYER], !next);
    setVisibility(
      [FLOOR_EXTRUSION_LAYER, SHOPS_EXTRUSION_LAYER, NAV_ROUTE_RIBBON_LAYER],
      next,
    );
    setVisibility(NAV_LINE_LAYERS, !next);
    fitBoundsRef.current?.();
  };

  const changeNavMode = (next) => {
    if (next === navMode) return;
    navModeRef.current = next;
    setNavMode(next);
    setSelectStart(null);
    setSelectEnd(null);
    navApiRef.current?.clear();
  };

  const handleSelectShop = (which, value) => {
    const nextStart = which === "start" ? value ?? null : selectStart;
    const nextEnd = which === "end" ? value ?? null : selectEnd;
    setSelectStart(nextStart);
    setSelectEnd(nextEnd);
    navApiRef.current?.routeByUid(nextStart, nextEnd);
  };

  const resetSelectRoute = () => {
    setSelectStart(null);
    setSelectEnd(null);
    navApiRef.current?.clear();
  };

  const fitAll = () => fitBoundsRef.current?.();

  return {
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
  };
}
