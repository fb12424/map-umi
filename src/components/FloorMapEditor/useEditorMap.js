import { useEffect, useRef, useState } from "react";
import {
  AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CORRIDOR_COLOR, featureBounds } from "../../lib/geoCommon.js";
import { labelPoint, shortLabel } from "../../lib/shopGeometry.js";
import { geometryToPolygons } from "../../lib/polygonOps.js";
import {
  DRAFT_FILL_LAYER,
  DRAFT_LINE_LAYER,
  DRAFT_POINTS_LAYER,
  DRAFT_SOURCE,
  EMPTY_DRAFT,
  FILL_COLOR,
  FILL_LAYER,
  FLOOR_LAYER,
  FLOOR_SOURCE,
  MIN_RECT_PIXELS,
  OUTLINE_LAYER,
  SNAP_PIXELS,
  SOURCE_ID,
  dedupePoints,
  ellipseRing,
  rectangleRing,
  toXy,
} from "./editorCore.js";

export default function useEditorMap({
  shops,
  selection,
  tool,
  shape,
  floor,
  onFinishShape,
  onFinishLine,
  onPick,
  onSwitchToSelect,
  onClearSelection,
}) {
  const [ready, setReady] = useState(false);
  const [drawing, setDrawing] = useState(false);

  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const shopsRef = useRef(shops);
  const toolRef = useRef(tool);
  const shapeRef = useRef(shape);
  const labelsRef = useRef([]);
  const draftRef = useRef({ ...EMPTY_DRAFT });
  const snapDataRef = useRef({ vertices: [], segments: [] });
  const snapMarkerRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedStateRef = useRef([]);

  const onFinishShapeRef = useRef(onFinishShape);
  const onFinishLineRef = useRef(onFinishLine);
  const onPickRef = useRef(onPick);
  const onSwitchToSelectRef = useRef(onSwitchToSelect);
  const onClearSelectionRef = useRef(onClearSelection);

  shopsRef.current = shops;
  toolRef.current = tool;
  shapeRef.current = shape;
  onFinishShapeRef.current = onFinishShape;
  onFinishLineRef.current = onFinishLine;
  onPickRef.current = onPick;
  onSwitchToSelectRef.current = onSwitchToSelect;
  onClearSelectionRef.current = onClearSelection;

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

    onFinishShapeRef.current([
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
    onFinishShapeRef.current([[...points, points[0]].map(toXy)]);
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

  const finishLine = () => {
    const [start, end] = draftRef.current.points;
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();

    onFinishLineRef.current(start, end);
  };

  const addLinePoint = (lngLat) => {
    const map = mapRef.current;
    if (!map) return;

    const snapped = snapAt(map.project(lngLat));
    const point = snapped?.lngLat ?? lngLat;
    const draft = draftRef.current;

    if (!draft.points.length) {
      draftRef.current = { ...draft, points: [point], cursor: point };
      setDrawing(true);
      renderDraft();
      return;
    }

    const first = map.project(draft.points[0]);
    const current = map.project(point);
    if (Math.hypot(first.x - current.x, first.y - current.y) <= SNAP_PIXELS) {
      return;
    }

    draftRef.current = {
      ...draft,
      points: [draft.points[0], point],
      cursor: point,
    };
    finishLine();
  };

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
        onPickRef.current(uid);
        return;
      }

      if (shapeRef.current === "polygon") addPolygonVertex(event.lngLat);
      else if (shapeRef.current === "line") addLinePoint(event.lngLat);
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
          onSwitchToSelectRef.current();
        } else {
          onClearSelectionRef.current();
        }
        return;
      }

      if (
        event.key === "Enter" &&
        shapeRef.current === "polygon" &&
        draftRef.current.points.length
      ) {
        event.preventDefault();
        finishPolygon();
        return;
      }

      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        draftRef.current.points.length
      ) {
        event.preventDefault();
        const nextPoints = draftRef.current.points.slice(0, -1);
        draftRef.current = { ...draftRef.current, points: nextPoints };
        if (!nextPoints.length) setDrawing(false);
        renderDraft();
      }
    };

    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { containerRef, drawing, clearDraft };
}
