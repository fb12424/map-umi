import { useEffect, useReducer, useRef, useState } from "react";
import { UndoOutlined } from "@ant-design/icons";
import { Button, Popconfirm, Segmented, Space, message } from "antd";
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { deriveFloorFromShops } from "../lib/floorGeometry.js";
import { labelPoint, shortLabel } from "../lib/shopGeometry.js";
import {
  areaChanged,
  buildEditedDataset,
  cleanPolygons,
  createShopFeature,
  geometryToPolygons,
  nextShopUid,
  polygonsAreaM2,
  subtractPolygons,
  unionPolygons,
  updateShopGeometry,
} from "../lib/polygonOps.js";
import "./FloorMapEditor.css";

const SOURCE_ID = "editor-shops";
const FLOOR_SOURCE = "editor-floor";
const FILL_LAYER = "editor-shops-fill";
const OUTLINE_LAYER = "editor-shops-outline";
const FLOOR_LAYER = "editor-floor-fill";
const DRAFT_SOURCE = "editor-draft";
const DRAFT_FILL_LAYER = "editor-draft-fill";
const DRAFT_LINE_LAYER = "editor-draft-line";
const DRAFT_POINTS_LAYER = "editor-draft-points";

const SNAP_PIXELS = 8;
const MIN_RECT_PIXELS = 4;
const ELLIPSE_SEGMENTS = 64;
const HISTORY_LIMIT = 40;
const ADD_MIN_FREE_M2 = 1;
const ADD_MIN_FREE_RATIO = 0.05;

const CORRIDOR_COLOR = "#f4e5c9";
const HOVER_COLOR = "#f2a33a";
const SELECTED_COLOR = "#2563eb";

const AREA_COLOR = [
  "step",
  ["coalesce", ["get", "area_m2"], 0],
  "#c3d9f2",
  30,
  "#98bde8",
  60,
  "#6597d7",
  120,
  "#3c72bb",
  200,
  "#1d4a8f",
];

const FILL_COLOR = [
  "case",
  ["boolean", ["feature-state", "selected"], false],
  SELECTED_COLOR,
  ["boolean", ["feature-state", "hover"], false],
  HOVER_COLOR,
  AREA_COLOR,
];

const EMPTY_DRAFT = { points: [], cursor: null, start: null, dragging: false };

function filterSelection(selection, shops) {
  const uids = new Set(shops.features.map((feature) => feature.properties.uid));
  return selection.filter((uid) => uids.has(uid));
}

function editorReducer(state, action) {
  switch (action.type) {
    case "select":
      return { ...state, selection: action.selection };
    case "commit":
      return {
        shops: action.shops,
        selection: filterSelection(action.selection ?? [], action.shops),
        past: [...state.past, state.shops].slice(-HISTORY_LIMIT),
      };
    case "undo": {
      if (!state.past.length) return state;
      const shops = state.past[state.past.length - 1];
      return {
        shops,
        selection: filterSelection(state.selection, shops),
        past: state.past.slice(0, -1),
      };
    }
    default:
      return state;
  }
}

function featureBounds(features) {
  const bounds = new LngLatBounds();
  const walk = (coords) => {
    if (typeof coords[0] === "number") {
      bounds.extend(coords);
      return;
    }
    coords.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  return bounds;
}

function rectangleRing(start, end) {
  return [
    [start.lng, start.lat],
    [end.lng, start.lat],
    [end.lng, end.lat],
    [start.lng, end.lat],
    [start.lng, start.lat],
  ];
}

function ellipseRing(start, end) {
  const cx = (start.lng + end.lng) / 2;
  const cy = (start.lat + end.lat) / 2;
  const rx = Math.abs(end.lng - start.lng) / 2;
  const ry = Math.abs(end.lat - start.lat) / 2;
  const ring = [];

  for (let i = 0; i < ELLIPSE_SEGMENTS; i += 1) {
    const angle = (i / ELLIPSE_SEGMENTS) * Math.PI * 2;
    ring.push([cx + rx * Math.cos(angle), cy + ry * Math.sin(angle)]);
  }
  ring.push(ring[0]);
  return ring;
}

function dedupePoints(points) {
  const result = [];
  for (const point of points) {
    const last = result[result.length - 1];
    if (!last || last.lng !== point.lng || last.lat !== point.lat) {
      result.push(point);
    }
  }
  return result;
}

const toXy = (point) => [point.lng, point.lat];

export default function FloorMapEditor({
  dataset,
  floorGeojson,
  onCancel,
  onApply,
}) {
  const [state, dispatch] = useReducer(
    editorReducer,
    dataset.shops,
    (shops) => ({
      shops,
      selection: [],
      past: [],
    }),
  );
  const { shops, selection, past } = state;

  const [tool, setTool] = useState("select");
  const [shape, setShape] = useState("rect");
  const [drawing, setDrawing] = useState(false);
  const [ready, setReady] = useState(false);
  const [floor, setFloor] = useState(floorGeojson ?? null);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const shopsRef = useRef(shops);
  const selectionRef = useRef(selection);
  const toolRef = useRef(tool);
  const shapeRef = useRef(shape);
  const labelsRef = useRef([]);
  const draftRef = useRef({ ...EMPTY_DRAFT });
  const snapRef = useRef(null);
  const snapDataRef = useRef({ vertices: [], segments: [] });
  const snapMarkerRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedStateRef = useRef([]);
  const occupiedRef = useRef({ shops: null, polygons: [] });

  shopsRef.current = shops;
  selectionRef.current = selection;
  toolRef.current = tool;
  shapeRef.current = shape;

  const getOccupiedPolygons = () => {
    if (occupiedRef.current.shops === shopsRef.current) {
      return occupiedRef.current.polygons;
    }
    const polygons = unionPolygons(
      shopsRef.current.features.flatMap((feature) =>
        geometryToPolygons(feature.geometry),
      ),
    );
    occupiedRef.current = { shops: shopsRef.current, polygons };
    return polygons;
  };

  const renderDraft = () => {
    const map = mapRef.current;
    const source = map?.getSource(DRAFT_SOURCE);
    if (!source) return;

    const { points, cursor, start, dragging } = draftRef.current;
    const features = [];
    let ring = null;

    if (dragging && start && cursor) {
      ring =
        shapeRef.current === "ellipse"
          ? ellipseRing(start, cursor)
          : rectangleRing(start, cursor);
    } else if (points.length) {
      const preview = cursor ? [...points, cursor] : points;
      if (preview.length > 2) ring = [...preview, preview[0]].map(toXy);
    }

    const line =
      ring ??
      (cursor && points.length ? [...points, cursor] : points).map(toXy);
    if (line.length >= 2) {
      features.push({
        type: "Feature",
        properties: { kind: "line" },
        geometry: { type: "LineString", coordinates: line },
      });
    }
    if (ring && ring.length >= 4) {
      features.push({
        type: "Feature",
        properties: { kind: "fill" },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }

    const vertices = dragging ? [start, cursor].filter(Boolean) : points;
    for (const point of vertices) {
      features.push({
        type: "Feature",
        properties: { kind: "point" },
        geometry: { type: "Point", coordinates: toXy(point) },
      });
    }

    source.setData({ type: "FeatureCollection", features });
  };

  const updateSnapMarker = (snapped) => {
    const marker = snapMarkerRef.current;
    if (!marker) return;
    if (!snapped) {
      marker.getElement().classList.remove("is-visible");
      return;
    }
    marker.setLngLat([snapped.lngLat.lng, snapped.lngLat.lat]);
    marker.getElement().classList.add("is-visible");
  };

  const clearDraft = () => {
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();
  };

  const refreshSnapData = () => {
    const vertices = [];
    const segments = [];

    for (const feature of shopsRef.current.features) {
      for (const polygon of geometryToPolygons(feature.geometry)) {
        for (const ring of polygon) {
          const offset = vertices.length;
          for (const [lng, lat] of ring) vertices.push({ lng, lat });
          for (let i = offset; i < vertices.length - 1; i += 1) {
            segments.push([i, i + 1]);
          }
        }
      }
    }

    snapDataRef.current = { vertices, segments };
  };

  const snapAt = (screenPoint) => {
    const map = mapRef.current;
    if (!map) return null;

    const { vertices, segments } = snapDataRef.current;
    if (!vertices.length) return null;

    const projected = vertices.map((vertex) =>
      map.project([vertex.lng, vertex.lat]),
    );

    let best = null;
    let bestDistance = SNAP_PIXELS;

    for (let i = 0; i < projected.length; i += 1) {
      const point = projected[i];
      const distance = Math.hypot(
        point.x - screenPoint.x,
        point.y - screenPoint.y,
      );
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { lngLat: vertices[i], type: "vertex" };
      }
    }

    if (!best) {
      for (const [i, j] of segments) {
        const a = projected[i];
        const b = projected[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const lengthSq = dx * dx + dy * dy;
        if (!lengthSq) continue;

        const t = Math.max(
          0,
          Math.min(
            1,
            ((screenPoint.x - a.x) * dx + (screenPoint.y - a.y) * dy) /
              lengthSq,
          ),
        );
        const x = a.x + dx * t;
        const y = a.y + dy * t;
        const distance = Math.hypot(screenPoint.x - x, screenPoint.y - y);

        if (distance < bestDistance) {
          bestDistance = distance;
          best = {
            lngLat: {
              lng: vertices[i].lng + (vertices[j].lng - vertices[i].lng) * t,
              lat: vertices[i].lat + (vertices[j].lat - vertices[i].lat) * t,
            },
            type: "edge",
          };
        }
      }
    }

    return best;
  };

  const applyCrop = (shapePolygon) => {
    const selected = new Set(selectionRef.current);
    if (!selected.size) {
      message.warning("请先在“选择”模式下选中要裁切的铺位");
      return;
    }

    let changed = 0;
    let removed = 0;
    const nextFeatures = [];

    for (const feature of shopsRef.current.features) {
      if (!selected.has(feature.properties.uid)) {
        nextFeatures.push(feature);
        continue;
      }

      const polygons = geometryToPolygons(feature.geometry);
      const beforeArea = polygonsAreaM2(polygons);
      const result = cleanPolygons(subtractPolygons(polygons, shapePolygon));

      if (!result.length) {
        changed += 1;
        removed += 1;
        continue;
      }

      const afterArea = polygonsAreaM2(result);
      if (!areaChanged(beforeArea, afterArea)) {
        nextFeatures.push(feature);
        continue;
      }

      nextFeatures.push(updateShopGeometry(feature, result));
      changed += 1;
    }

    if (!changed) {
      message.info("所选铺位与圈选区域没有重叠");
      return;
    }

    const uids = new Set(nextFeatures.map((feature) => feature.properties.uid));
    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [...selected].filter((uid) => uids.has(uid)),
    });
    message.success(
      `已裁切 ${changed} 个铺位${removed ? `，${removed} 个被完全移除` : ""}`,
    );
  };

  const applyAdd = (shapePolygon) => {
    const occupied = getOccupiedPolygons();
    const result = cleanPolygons(subtractPolygons(shapePolygon, occupied));
    const shapeArea = polygonsAreaM2(shapePolygon);
    const freeArea = polygonsAreaM2(result);
    if (
      !result.length ||
      freeArea < ADD_MIN_FREE_M2 ||
      freeArea / shapeArea < ADD_MIN_FREE_RATIO
    ) {
      message.warning("圈选区域已被现有铺位占满，未新增铺位");
      return;
    }

    const uid = nextShopUid(shopsRef.current.features);
    const feature = createShopFeature(result, {
      uid,
      code: "",
      merchantNo: "",
      merchantName: "",
    });

    dispatch({
      type: "commit",
      shops: {
        type: "FeatureCollection",
        features: [...shopsRef.current.features, feature],
      },
      selection: [uid],
    });
    message.success("已新增 1 个铺位");
  };

  const finishShape = (polygon) => {
    if (toolRef.current === "crop") applyCrop(polygon);
    else if (toolRef.current === "add") applyAdd(polygon);
  };

  const finishDragShape = () => {
    const draft = draftRef.current;
    if (!draft.dragging) return;

    const map = mapRef.current;
    const { start, cursor } = draft;
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();

    if (!map || !start || !cursor) return;
    const a = map.project(start);
    const b = map.project(cursor);
    if (
      Math.abs(a.x - b.x) < MIN_RECT_PIXELS ||
      Math.abs(a.y - b.y) < MIN_RECT_PIXELS
    ) {
      return;
    }

    finishShape([
      shapeRef.current === "ellipse"
        ? ellipseRing(start, cursor)
        : rectangleRing(start, cursor),
    ]);
  };

  const finishPolygon = () => {
    const points = dedupePoints(draftRef.current.points);
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();

    if (points.length < 3) return;
    finishShape([[...points, points[0]].map(toXy)]);
  };

  const addPolygonVertex = (lngLat) => {
    const map = mapRef.current;
    if (!map) return;

    const snapped = snapAt(map.project(lngLat));
    const point = snapped?.lngLat ?? lngLat;
    const draft = draftRef.current;

    if (draft.points.length >= 3) {
      const first = map.project(draft.points[0]);
      const current = map.project(point);
      if (Math.hypot(first.x - current.x, first.y - current.y) <= SNAP_PIXELS) {
        finishPolygon();
        return;
      }
    }

    draftRef.current = {
      ...draft,
      points: [...draft.points, point],
      cursor: point,
    };
    setDrawing(true);
    renderDraft();
  };

  const handleToolChange = (next) => {
    if (next === "add") {
      dispatch({
        type: "select",
        selection: [],
      });
    }
    clearDraft();
    setTool(next);
  };

  const handleShapeChange = (next) => {
    clearDraft();
    setShape(next);
  };

  const handleMerge = () => {
    const selected = new Set(selectionRef.current);
    const picked = shopsRef.current.features.filter((feature) =>
      selected.has(feature.properties.uid),
    );
    if (picked.length < 2) {
      message.warning("请至少选择 2 个铺位再合并");
      return;
    }

    const merged = cleanPolygons(
      unionPolygons(
        picked.flatMap((feature) => geometryToPolygons(feature.geometry)),
      ),
    );
    if (!merged.length) {
      message.error("合并失败：结果为空");
      return;
    }

    const keepUid = picked[0].properties.uid;
    const nextFeatures = [];
    for (const feature of shopsRef.current.features) {
      const uid = feature.properties.uid;
      if (!selected.has(uid)) nextFeatures.push(feature);
      else if (uid === keepUid)
        nextFeatures.push(updateShopGeometry(feature, merged));
    }

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [keepUid],
    });
    message.success(
      `已合并 ${picked.length} 个铺位，保留 ${picked[0].properties.label}`,
    );
  };

  const handleSplit = () => {
    const selected = new Set(selectionRef.current);
    const targets = shopsRef.current.features.filter(
      (feature) =>
        selected.has(feature.properties.uid) &&
        geometryToPolygons(feature.geometry).length > 1,
    );
    if (!targets.length) {
      message.warning("请选择至少 1 个由多个部分组成的铺位再拆分");
      return;
    }

    const targetUids = new Set(
      targets.map((feature) => feature.properties.uid),
    );
    const uidPool = [...shopsRef.current.features];
    const nextFeatures = [];
    const nextSelection = [];
    let totalParts = 0;

    for (const feature of shopsRef.current.features) {
      if (!targetUids.has(feature.properties.uid)) {
        nextFeatures.push(feature);
        continue;
      }

      const polygons = geometryToPolygons(feature.geometry);
      polygons.forEach((polygon, index) => {
        totalParts += 1;
        if (index === 0) {
          nextFeatures.push(updateShopGeometry(feature, [polygon]));
          nextSelection.push(feature.properties.uid);
          return;
        }

        const part = createShopFeature([polygon], {
          uid: nextShopUid(uidPool),
          code: "",
          merchantNo: "",
          merchantName: "",
        });
        uidPool.push(part);
        nextFeatures.push(part);
        nextSelection.push(part.properties.uid);
      });
    }

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: nextSelection,
    });
    message.success(
      `已将 ${targets.length} 个铺位拆分为 ${totalParts} 个铺位，新增部分请填写铺位号`,
    );
  };

  const handleDelete = () => {
    const selected = new Set(selectionRef.current);
    const nextFeatures = shopsRef.current.features.filter(
      (feature) => !selected.has(feature.properties.uid),
    );
    const removed = shopsRef.current.features.length - nextFeatures.length;

    dispatch({
      type: "commit",
      shops: { type: "FeatureCollection", features: nextFeatures },
      selection: [],
    });
    message.success(`已删除 ${removed} 个铺位`);
  };

  const handleApply = () => {
    if (!shops.features.length) {
      message.warning("编辑结果没有铺位，请撤销或取消");
      return;
    }
    onApply(buildEditedDataset(dataset, shops));
  };

  useEffect(() => {
    if (floor || !dataset.shops.features.length) return undefined;

    const timer = setTimeout(() => {
      try {
        setFloor(deriveFloorFromShops(dataset.shops.features));
      } catch (error) {
        console.warn("楼板派生失败，仅显示商铺", error);
      }
    }, 0);

    return () => clearTimeout(timer);
  }, [floor, dataset]);

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
      minZoom: 14,
      maxZoom: 22,
      maxPitch: 0,
      touchPitch: false,
    });

    mapRef.current = map;
    map.addControl(new NavigationControl({ showCompass: false }), "top-right");
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: "数据：本地上传 · WGS84",
      }),
      "bottom-right",
    );

    const rebuildLabels = (features) => {
      for (const item of labelsRef.current) item.marker.remove();
      labelsRef.current = [];

      for (const feature of features) {
        const code = (feature.properties.code || "").trim();
        if (!code) continue;

        const element = document.createElement("div");
        element.className = "editor-shop-label";
        element.textContent = shortLabel(code);
        const marker = new Marker({ element, anchor: "center" })
          .setLngLat(labelPoint(feature.geometry))
          .addTo(map);
        labelsRef.current.push({ uid: feature.properties.uid, marker });
      }
    };

    const setHover = (uid) => {
      if (uid === hoveredRef.current) return;
      if (hoveredRef.current && map.getSource(SOURCE_ID)) {
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredRef.current },
          { hover: false },
        );
      }
      hoveredRef.current = uid;
      if (uid) {
        map.setFeatureState({ source: SOURCE_ID, id: uid }, { hover: true });
      }
    };

    const onLoad = () => {
      map.addSource(SOURCE_ID, {
        type: "geojson",
        data: shopsRef.current,
        promoteId: "uid",
      });
      map.addLayer({
        id: FILL_LAYER,
        type: "fill",
        source: SOURCE_ID,
        paint: {
          "fill-color": FILL_COLOR,
          "fill-opacity": 0.88,
        },
      });
      map.addLayer({
        id: OUTLINE_LAYER,
        type: "line",
        source: SOURCE_ID,
        paint: {
          "line-color": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            "#1d4ed8",
            ["boolean", ["feature-state", "hover"], false],
            "#f97316",
            "#ffffff",
          ],
          "line-width": [
            "case",
            ["boolean", ["feature-state", "selected"], false],
            3,
            ["boolean", ["feature-state", "hover"], false],
            2.4,
            1.1,
          ],
        },
      });

      map.addSource(DRAFT_SOURCE, {
        type: "geojson",
        data: { type: "FeatureCollection", features: [] },
      });
      map.addLayer({
        id: DRAFT_FILL_LAYER,
        type: "fill",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "fill"],
        paint: { "fill-color": "#2563eb", "fill-opacity": 0.18 },
      });
      map.addLayer({
        id: DRAFT_LINE_LAYER,
        type: "line",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "line"],
        paint: {
          "line-color": "#2563eb",
          "line-width": 1.5,
          "line-dasharray": [5, 3],
        },
      });
      map.addLayer({
        id: DRAFT_POINTS_LAYER,
        type: "circle",
        source: DRAFT_SOURCE,
        filter: ["==", ["get", "kind"], "point"],
        paint: {
          "circle-radius": 3.5,
          "circle-color": "#2563eb",
          "circle-stroke-color": "#ffffff",
          "circle-stroke-width": 1.5,
        },
      });

      const snapElement = document.createElement("div");
      snapElement.className = "editor-snap";
      snapMarkerRef.current = new Marker({
        element: snapElement,
        anchor: "center",
      })
        .setLngLat([119.30015, 26.08005])
        .addTo(map);

      rebuildLabels(shopsRef.current.features);

      const bounds = featureBounds(shopsRef.current.features);
      if (!bounds.isEmpty()) {
        const camera = map.cameraForBounds(bounds, {
          padding: { top: 190, right: 64, bottom: 64, left: 64 },
          maxZoom: 20,
        });
        if (camera) {
          map.jumpTo({ center: camera.center, zoom: camera.zoom });
        }
      }

      setReady(true);
    };

    if (map.isStyleLoaded()) onLoad();
    else map.on("load", onLoad);

    const onMouseMove = (event) => {
      const activeTool = toolRef.current;
      const mapInstance = mapRef.current;
      if (!mapInstance) return;

      if (activeTool === "select") {
        const features = mapInstance.queryRenderedFeatures(event.point, {
          layers: [FILL_LAYER],
        });
        setHover(features.length ? features[0].properties.uid : null);
        mapInstance.getCanvas().style.cursor = features.length ? "pointer" : "";
        return;
      }

      const snapped = snapAt(event.point);
      updateSnapMarker(snapped);
      if (draftRef.current.dragging || draftRef.current.points.length) {
        draftRef.current = {
          ...draftRef.current,
          cursor: snapped?.lngLat ?? event.lngLat,
        };
        renderDraft();
      }
    };

    const onMouseOut = () => {
      setHover(null);
      updateSnapMarker(null);
    };

    const onClick = (event) => {
      if (toolRef.current === "select") {
        const features = map.queryRenderedFeatures(event.point, {
          layers: [FILL_LAYER],
        });
        const uid = features.length ? features[0].properties.uid : null;
        const current = selectionRef.current;
        const next = uid
          ? current.includes(uid)
            ? current.filter((item) => item !== uid)
            : [...current, uid]
          : [];
        dispatch({ type: "select", selection: next });
        return;
      }

      if (shapeRef.current === "polygon") addPolygonVertex(event.lngLat);
    };

    const onMouseDown = (event) => {
      if (event.originalEvent?.button !== 0) return;
      if (toolRef.current === "select") return;
      if (shapeRef.current !== "rect" && shapeRef.current !== "ellipse") return;
      event.preventDefault();
      const point = snapAt(event.point)?.lngLat ?? event.lngLat;
      draftRef.current = {
        ...draftRef.current,
        dragging: true,
        start: point,
        cursor: point,
      };
      renderDraft();
    };

    const onDoubleClick = (event) => {
      if (toolRef.current === "select" || shapeRef.current !== "polygon")
        return;
      event.preventDefault?.();
      finishPolygon();
    };

    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("click", onClick);
    map.on("mousedown", onMouseDown);
    map.on("mouseup", finishDragShape);
    map.on("dblclick", onDoubleClick);
    window.addEventListener("mouseup", finishDragShape);

    return () => {
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("click", onClick);
      map.off("mousedown", onMouseDown);
      map.off("mouseup", finishDragShape);
      map.off("dblclick", onDoubleClick);
      window.removeEventListener("mouseup", finishDragShape);

      for (const item of labelsRef.current) item.marker.remove();
      labelsRef.current = [];
      snapMarkerRef.current = null;
      map.remove();
      mapRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready || !floor) return;
    if (map.getSource(FLOOR_SOURCE)) {
      map.getSource(FLOOR_SOURCE).setData(floor);
      return;
    }
    map.addSource(FLOOR_SOURCE, { type: "geojson", data: floor });
    map.addLayer(
      {
        id: FLOOR_LAYER,
        type: "fill",
        source: FLOOR_SOURCE,
        paint: { "fill-color": CORRIDOR_COLOR, "fill-opacity": 1 },
      },
      map.getLayer(FILL_LAYER) ? FILL_LAYER : undefined,
    );
  }, [ready, floor]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const source = map.getSource(SOURCE_ID);
    if (source) source.setData(shops);

    occupiedRef.current = { shops: null, polygons: [] };
    refreshSnapData();

    for (const item of labelsRef.current) item.marker.remove();
    labelsRef.current = [];
    for (const feature of shops.features) {
      const code = (feature.properties.code || "").trim();
      if (!code) continue;
      const element = document.createElement("div");
      element.className = "editor-shop-label";
      element.textContent = shortLabel(code);
      const marker = new Marker({ element, anchor: "center" })
        .setLngLat(labelPoint(feature.geometry))
        .addTo(map);
      labelsRef.current.push({ uid: feature.properties.uid, marker });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const next = new Set(selection);
    for (const uid of selectedStateRef.current) {
      if (!next.has(uid)) {
        map.setFeatureState(
          { source: SOURCE_ID, id: uid },
          { selected: false },
        );
      }
    }
    for (const uid of next) {
      map.setFeatureState({ source: SOURCE_ID, id: uid }, { selected: true });
    }
    selectedStateRef.current = [...next];
  }, [ready, selection, shops]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    const drawingTool = tool !== "select";
    const rectMode = drawingTool && shape === "rect";
    const ellipseMode = drawingTool && shape === "ellipse";
    const polygonMode = drawingTool && shape === "polygon";

    if (rectMode || ellipseMode) map.dragPan.disable();
    else map.dragPan.enable();
    map.boxZoom.disable();
    if (polygonMode) map.doubleClickZoom.disable();
    else map.doubleClickZoom.enable();

    map.getCanvas().style.cursor = drawingTool ? "crosshair" : "";
  }, [ready, tool, shape]);

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        if (draftRef.current.dragging || draftRef.current.points.length) {
          clearDraft();
        } else if (toolRef.current !== "select") {
          setTool("select");
        } else {
          dispatch({ type: "select", selection: [] });
        }
        return;
      }

      if (event.key === "Enter" && draftRef.current.points.length) {
        event.preventDefault();
        finishPolygon();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        draftRef.current.points.length
      ) {
        event.preventDefault();
        draftRef.current = {
          ...draftRef.current,
          points: draftRef.current.points.slice(0, -1),
        };
        renderDraft();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const selectedUidSet = new Set(selection);
  const splittableCount = shops.features.filter(
    (feature) =>
      selectedUidSet.has(feature.properties.uid) &&
      geometryToPolygons(feature.geometry).length > 1,
  ).length;

  const hint = drawing
    ? "双击或回车闭合多边形 · Backspace 撤销上一点 · Esc 取消"
    : tool === "select"
    ? "点击铺位选中或取消，可多选；点击空白处清空选择。"
    : tool === "crop"
    ? selection.length
      ? "拖拽矩形/椭圆或依次点击绘制多边形，圈中部分将从所选铺位中裁掉。"
      : "请先在“选择”模式下选中要裁切的铺位。"
    : "拖拽矩形/椭圆或依次点击绘制多边形，生成新铺位；与已有铺位重叠的部分会自动扣除。";

  return (
    <div className="editor-overlay">
      <div className="editor-map">
        <div ref={containerRef} className="editor-map-canvas" />

        <div className="editor-corner">
          <div className="editor-toolbar">
            <div className="editor-toolbar-row">
              <Button
                size="small"
                icon={<UndoOutlined />}
                title="撤销上一步"
                disabled={!past.length}
                onClick={() => dispatch({ type: "undo" })}
              >
                撤销
              </Button>
              <span className="editor-toolbar-divider" />

              <span className="editor-toolbar-label">编辑模式</span>
              <Button
                type={tool === "select" ? "primary" : "default"}
                onClick={() => handleToolChange("select")}
              >
                选择铺位
              </Button>
              <Button
                type={tool === "add" ? "primary" : "default"}
                onClick={() => handleToolChange("add")}
              >
                新增铺位
              </Button>

              <Space size={8} className="editor-toolbar-actions">
                <Button size="small" onClick={onCancel}>
                  取消
                </Button>
                <Button size="small" type="primary" onClick={handleApply}>
                  应用修改
                </Button>
              </Space>
            </div>

            <div className="editor-toolbar-row editor-toolbar-secondary">
              <span className="editor-toolbar-label">铺位操作</span>
              <Button
                size="small"
                disabled={!selection.length}
                className={tool === "crop" ? "editor-tool-active" : ""}
                onClick={() => handleToolChange("crop")}
              >
                裁切所选
              </Button>
              <Button
                size="small"
                disabled={selection.length < 2}
                onClick={handleMerge}
              >
                合并所选
              </Button>
              <Button
                size="small"
                disabled={!splittableCount}
                title="将选中铺位的每个独立部分拆成单独铺位，铺位号保留在第一个"
                onClick={handleSplit}
              >
                拆分所选{splittableCount ? `（${splittableCount}）` : ""}
              </Button>
              {selection.length ? (
                <Popconfirm
                  title={`删除选中的 ${selection.length} 个铺位？`}
                  okText="删除"
                  cancelText="取消"
                  placement="bottom"
                  onConfirm={handleDelete}
                >
                  <Button size="small" danger>
                    删除所选
                  </Button>
                </Popconfirm>
              ) : (
                <Button size="small" danger disabled>
                  删除所选
                </Button>
              )}
            </div>
            {tool !== "select" && (
              <div className="editor-toolbar-row editor-toolbar-secondary">
                <Segmented
                  size="small"
                  value={shape}
                  onChange={handleShapeChange}
                  options={[
                    { label: "矩形", value: "rect" },
                    { label: "椭圆", value: "ellipse" },
                    { label: "多边形", value: "polygon" },
                  ]}
                />
              </div>
            )}
          </div>
          <div className="editor-summary">
            <div className="editor-summary-item">
              <span className="editor-summary-label">铺位</span>
              <span className="editor-summary-value">
                {shops.features.length}
              </span>
            </div>
            <span className="editor-summary-divider" />
            <div className="editor-summary-item">
              <span className="editor-summary-label">已选</span>
              <span
                className={
                  selection.length
                    ? "editor-summary-value is-active"
                    : "editor-summary-value"
                }
              >
                {selection.length}
              </span>
            </div>
          </div>
        </div>

        <div className="editor-hint">{hint}</div>
      </div>
    </div>
  );
}

