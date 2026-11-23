// 编辑器地图 Hook：MapLibre 实例的创建/销毁、铺位与草稿数据同步、吸附、键鼠交互。
// 主 effect 只执行一次，所以所有地图事件处理器都在创建时闭包一次；
// 需要随渲染变化的值（shops/tool/shape/回调）统一从下方"最新值 ref"读取，
// 避免每次 props 变化都解绑重绑全部地图事件。
import { useEffect, useRef, useState } from "react";
import {
  // AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { CORRIDOR_COLOR, featureBounds } from "../../lib/geoCommon.js";
import { labelPoint } from "../../lib/shopGeometry.js";
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
  // 最新值 ref：地图事件在 mount 时闭包一次，之后从这里读当前状态
  const shopsRef = useRef(shops);
  const toolRef = useRef(tool);
  const shapeRef = useRef(shape);
  // 铺位位号标注（DOM Marker）与吸附标记
  const labelsRef = useRef([]);
  // 绘制草稿：拖动中的矩形/椭圆、多边形的点序列、线段起点都放在这里；
  // 草稿不进入 React state，鼠标移动只改 ref 并重绘图层，避免高频渲染
  const draftRef = useRef({ ...EMPTY_DRAFT });
  // 吸附缓存：所有铺位环的顶点，以及用"全局顶点下标对"表示的边
  const snapDataRef = useRef({ vertices: [], segments: [] });
  const snapMarkerRef = useRef(null);
  const hoveredRef = useRef(null);
  // 上一次同步到 feature-state 的选中 uid，用于做差量更新
  const selectedStateRef = useRef([]);

  // 回调 ref：父组件每次渲染都传新函数，事件处理器通过 ref 调用最新版本
  const onFinishShapeRef = useRef(onFinishShape);
  const onFinishLineRef = useRef(onFinishLine);
  const onPickRef = useRef(onPick);
  const onSwitchToSelectRef = useRef(onSwitchToSelect);
  const onClearSelectionRef = useRef(onClearSelection);

  // 每次渲染同步一次，保证地图事件触发时拿到的永远是最新数据
  shopsRef.current = shops;
  toolRef.current = tool;
  shapeRef.current = shape;
  onFinishShapeRef.current = onFinishShape;
  onFinishLineRef.current = onFinishLine;
  onPickRef.current = onPick;
  onSwitchToSelectRef.current = onSwitchToSelect;
  onClearSelectionRef.current = onClearSelection;

  // 把草稿拼成一组临时 feature 写进 DRAFT_SOURCE：
  // 拖拽中是矩形/椭圆环；多边形/线段是折线（多边形在点够 3 个时附带闭合预览）。
  // 三个草稿图层用 kind 属性过滤，分别渲染填充、虚线和顶点圆点
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
      // 多边形至少 3 点才值得画闭合填充预览
      if (preview.length > 2) ring = [...preview, preview[0]].map(toXy);
    }

    // 折线始终跟随当前草稿：拖拽时就是矩形/椭圆的外环，其余情况是已落点 + 预览点
    const line =
      ring ??
      (cursor && points.length ? [...points, cursor] : points).map(toXy);
    if (line.length >= 2) { // 画线
      features.push({
        type: "Feature",
        properties: { kind: "line" },
        geometry: { type: "LineString", coordinates: line },
      });
    }
    if (ring && ring.length >= 4) { // 画面
      features.push({
        type: "Feature",
        properties: { kind: "fill" },
        geometry: { type: "Polygon", coordinates: [ring] },
      });
    }

    // 顶点圆点：拖拽时只有起止两个控制点，其余情况是已确定的多边形/线段端点
    const vertices = dragging ? [start, cursor].filter(Boolean) : points;
    for (const point of vertices) { // 画顶点
      features.push({
        type: "Feature",
        properties: { kind: "point" },
        geometry: { type: "Point", coordinates: toXy(point) },
      });
    }

    source.setData({ type: "FeatureCollection", features });
  };

  // 吸附标记是常驻 Marker，用 CSS class 控制显隐（opacity 过渡），
  // 比反复 add/remove Marker 便宜，也不会触发地图重新布局
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

  // 清空草稿：取消绘制、隐藏吸附标记、清空草稿图层。
  // 切工具/切形状/按 Esc 都走这里
  const clearDraft = () => {
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();
  };

  // 重建吸附缓存：把每个铺位环的顶点摊平成一维数组，
  // segments 存的是"全局顶点下标对"，吸附时只需投影一次顶点，边线用下标回查
  const refreshSnapData = () => {
    const vertices = [];
    const segments = [];

    for (const feature of shopsRef.current.features) {
      for (const polygon of geometryToPolygons(feature.geometry)) {
        for (const ring of polygon) {
          // offset 记录当前环第一个顶点在全局数组中的位置，边只连本环内部相邻点，
          // 不会把不同环的首尾错误地连起来
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

  // 在屏幕像素空间里找吸附目标：先把点投影到画布坐标，
  // 优先吸附 SNAP_PIXELS 内最近的顶点；找不到再投影到每条边线上取最近点。
  // 返回 { lngLat, type: "vertex" | "edge" }，供绘制时替换落点
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

        // t 是投影点在线段参数上的位置，夹在 [0,1] 内保证落点不越出线段；
        // 经纬度按同样的 t 插值，避免"像素投影点 → 反投影"带来的精度损失
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

  // 鼠标抬起结束拖拽。宽或高不足 MIN_RECT_PIXELS 视为误触，直接丢弃。
  // 除了画布的 mouseup，外面还监听 window：松开时鼠标可能已经滑出画布
  const finishDragShape = () => {
    const draft = draftRef.current;
    if (!draft.dragging) return;

    const map = mapRef.current;
    const { start, cursor } = draft;
    // 先重置草稿再回调，保证上层操作抛异常也不会留下脏草稿
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

  // 闭合多边形：相邻重复点去重后至少 3 个点才有效，首尾闭合交给上层
  const finishPolygon = () => {
    const points = dedupePoints(draftRef.current.points);
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();

    if (points.length < 3) return;
    onFinishShapeRef.current([[...points, points[0]].map(toXy)]);
  };

  // 点击落点：先吸附；已有 3 个点且点回起点附近即视为闭合。
  // 闭合判定放在加点之前，所以不会多出一个与起点重复的顶点
  const addPolygonVertex = (lngLat) => {
    const map = mapRef.current;
    if (!map) return;

    const snapped = snapAt(map.project(lngLat));
    const point = snapped?.lngLat ?? lngLat;
    const draft = draftRef.current;

    if (draft.points.length >= 3) {
      const first = map.project(draft.points[0]);
      const current = map.project(point);
      // 多边形当前光标结束点与起始点距离小于8时，表示已手动闭合，跳出草稿，直接输出图形
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

  // 线段只需要两个点：完成时草稿里一定是 [起点, 终点]，直接回调上层
  const finishLine = () => {
    const [start, end] = draftRef.current.points;
    draftRef.current = { ...EMPTY_DRAFT };
    setDrawing(false);
    updateSnapMarker(null);
    renderDraft();

    onFinishLineRef.current(start, end);
  };

  // 线段绘制：第一次点击记起点；第二次点击若与起点重合（像素距离内）则忽略，
  // 防止误双击画出零长线，否则落终点并立即完成
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

  // 地图只创建一次：使用空白 style（不加载在线瓦片，编辑不依赖底图），
  // 禁止俯仰保持纯平面视角；初始视野落在本商场，加载后再按铺位范围适配
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
    // map.addControl(
    //   new AttributionControl({
    //     compact: true,
    //     customAttribution: "数据：本地上传 · WGS84",
    //   }),
    //   "bottom-right",
    // );

    // 位号标注用 DOM Marker 渲染（方便控制样式），空位号不画。
    // 标注不接收鼠标事件，点击会穿透到下方铺位
    const rebuildLabels = (features) => {
      for (const item of labelsRef.current) item.marker.remove();
      labelsRef.current = [];

      for (const feature of features) {
        const code = (feature.properties.code || "").trim();
        if (!code) continue;

        const element = document.createElement("div");
        element.className = "editor-shop-label";
        element.textContent = code;
        const marker = new Marker({ element, anchor: "center" })
          .setLngLat(labelPoint(feature.geometry))
          .addTo(map);
        labelsRef.current.push({ uid: feature.properties.uid, marker });
      }
    };

    // 悬停高亮走 feature-state：只改 GPU 端状态，不重建 source，
    // 因此鼠标移动不会触发数据层重绘
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

    // style 就绪后才能 addSource/addLayer。
    // promoteId: "uid" 让 setFeatureState 直接用业务 uid 作为要素 id，
    // 数据整体 setData 后同一铺位的选中/悬停状态仍能保留
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
      // 草稿三图层共用一个数据源，靠 kind 属性过滤分工：
      // fill 半透明面、line 蓝色虚线、point 顶点圆点
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

      // 吸附提示标记：先放到商场中心占位，之后由 updateSnapMarker 控制显隐与位置
      const snapElement = document.createElement("div");
      snapElement.className = "editor-snap";
      snapMarkerRef.current = new Marker({
        element: snapElement,
        anchor: "center",
      })
        .setLngLat([119.30015, 26.08005])
        .addTo(map);

      rebuildLabels(shopsRef.current.features);

      // 初始视野套住全部铺位；顶部多留 190px 给悬浮工具栏，避免遮住最上面一排铺位
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

      // 选择模式：悬停高亮 + 手型指针
      if (activeTool === "select") {
        const features = mapInstance.queryRenderedFeatures(event.point, {
          layers: [FILL_LAYER],
        });
        setHover(features.length ? features[0].properties.uid : null);
        mapInstance.getCanvas().style.cursor = features.length ? "pointer" : "";
        return;
      }

      // 绘制模式：实时更新吸附标记和草稿预览点（拖拽中或已有落点时）
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

    // 鼠标移出画布：清掉悬停态和吸附标记，避免残留
    const onMouseOut = () => {
      setHover(null);
      updateSnapMarker(null);
    };

    // 点击：选择模式切换选中；绘制模式按形状依次落点（矩形/椭圆由拖拽处理，不响应点击）
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

    // 矩形/椭圆按住拖拽：mousedown 只记录起点，mouseup 才真正生成。
    // preventDefault 抑制默认的拖拽选择等行为
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

    // 双击闭合多边形（此前两次 click 已经把顶点陆续加进去了）
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
    // 拖拽可能在画布外松手，window 上再兜一次
    window.addEventListener("mouseup", finishDragShape);

    // 卸载时先解绑事件、移除标注，再销毁地图实例
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

  // 楼板层同步：已存在则只换数据，首次出现时插在铺位填充层下面，
  // 保证商铺颜色盖在楼板底色上
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

  // 铺位数据整体替换：更新 source、刷新吸附缓存、重建位号标注。
  // 选中/悬停是 feature-state，promoteId 保证同一 uid 的状态在 setData 后保留
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
      element.textContent = code;
      const marker = new Marker({ element, anchor: "center" })
        .setLngLat(labelPoint(feature.geometry))
        .addTo(map);
      labelsRef.current.push({ uid: feature.properties.uid, marker });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, shops]);

  // 选区同步到 feature-state：只对"新增选中"和"取消选中"的 uid 做差量更新，
  // 避免每次点击都把全量铺位刷一遍
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

  // 工具/形状变化时调整地图交互开关：
  // - 矩形/椭圆是按住拖拽绘制，必须禁掉地图平移，否则一拖就变成挪地图
  // - 多边形双击闭合与 MapLibre 的双击缩放冲突，需要临时禁用
  // - boxZoom 一律禁用（Shift 拖拽框选缩放和编辑操作容易混淆）
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

  // 全局键盘：
  // - Esc 由内到外逐级退出：取消当前草稿 → 退回选择模式 → 清空选择
  // - Enter 闭合多边形
  // - Backspace/Delete 删除最后一个已落点
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
        // 只删已落点，不删跟随鼠标的 cursor；点删光后退回"未开始绘制"状态
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

  // 对外只暴露容器 ref、是否正在绘制（给提示文案用）、清空草稿（切工具用）
  return { containerRef, drawing, clearDraft };
}
