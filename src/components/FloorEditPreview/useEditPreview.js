import { useEffect, useRef, useState } from "react";
import {
  // AttributionControl,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import { deriveFloorFromShops } from "../../lib/floorGeometry.js";
import {
  CORRIDOR_COLOR,
  featureBounds,
  merchantNameOf,
  OBSTACLE_OUTLINE_COLOR,
} from "../../lib/geoCommon.js";
import {
  AREA_TYPE,
  areaLabelOf,
  areaTypeOf,
  isObstacleFeature,
  labelPoint,
} from "../../lib/shopGeometry.js";
import {
  ALL_LAYERS,
  DUPLICATE_PROP,
  FILL_COLOR,
  FILL_LAYER,
  FLOOR_FILL_LAYER,
  FLOOR_SOURCE,
  HOVER_OUTLINE_COLOR,
  LABEL_MIN_ZOOM,
  LINKED_COLOR,
  OUTLINE_LAYER,
  SELECTED_OUTLINE_COLOR,
  SOURCE_ID,
  analyzeCodes,
  isValidFloor,
  labelTextFor,
  markDuplicates,
} from "./previewCore.js";
import { labelSize, renderShopLabel } from "../../lib/shopLabel.js";
import shopLabelStyles from "../../lib/shopLabel.less";

// 楼层预览 Hook。三块职责：
// 1) MapLibre 实例生命周期（只创建一次，卸载时销毁）；
// 2) 数据同步：商铺 GeoJSON + 楼板轮廓 → 数据源 / 图层 / DOM 标注；
// 3) 交互：hover、选中、联动、点击回传，统一通过 feature-state 驱动样式。
export default function useEditPreview({
  geojson,
  floor = null,
  fitKey,
  activeUid = null,
  linkedUid = null,
  showUnnumberedIndex = false,
  onShopClick,
  onFloorReady,
}) {
  // ref 分三类：
  // - 实例引用：map / 容器 / fit 闭包，跨渲染保持同一个对象；
  // - 运行时状态：当前 hover/选中/联动的 uid，只在命令式代码里读写，
  //   不进 React state，避免鼠标每移动一次就重渲染整棵树；
  // - 最新 props 镜像：回调与配置，供长生命周期的事件监听读取。
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const fitRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const linkedRef = useRef(null);
  const showIndexRef = useRef(showUnnumberedIndex);
  const labelsRef = useRef([]);
  const updateLabelsRef = useRef(null);
  const lastFitKeyRef = useRef(null);
  const onShopClickRef = useRef(onShopClick);
  const onFloorReadyRef = useRef(onFloorReady);
  const [mapReady, setMapReady] = useState(false);
  const [stats, setStats] = useState(null);

  // 无依赖数组：每次渲染都同步最新回调。
  // 父组件传的是内联箭头函数，若写进主 effect 依赖，每次父组件渲染都会重建地图；
  // 用 ref 转一层后，主 effect 只关心数据本身。
  useEffect(() => {
    onShopClickRef.current = onShopClick;
    onFloorReadyRef.current = onFloorReady;
  });

  // 地图只创建一次：内联 style 避免额外请求瓦片，只保留浅灰背景；
  // pitch 锁死为 0（maxPitch + touchPitch 双保险），保证是纯 2D 平面图。
  // center/zoom 是兜底视野，数据加载后会被自动 fit 覆盖。
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
    });

    mapRef.current = map;
    map.addControl(
      new NavigationControl({ showCompass: false }),
      "top-right",
    );
    // map.addControl(
    //   new AttributionControl({
    //     compact: true,
    //     customAttribution: "数据：本地上传 · WGS84",
    //   }),
    //   "bottom-right",
    // );

    // isStyleLoaded 兜底 StrictMode/HMR 二次挂载时 load 已经触发、事件不会再来一遍的情况
    if (map.isStyleLoaded()) {
      setMapReady(true);
    } else {
      map.on("load", () => setMapReady(true));
    }

    // 地图实例上的监听器随 remove 一起释放，这里只需清 ref 和就绪标记
    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  // 主数据 effect：geojson / floor / fitKey / 地图就绪任一变化 → 全量重建数据与标注。
  // 接受"全量重建"而不是增量 diff：铺位是几百级别，重建成本远低于维护可靠的增量同步。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    // fitKey 变化代表"换了一份数据"（首次加载、重新上传、撤销上传），只有这时才自动缩放全图；
    // 手动编辑里改商户名等操作也会替换 geojson，但不应打断用户当前视口。
    const isNewUpload = lastFitKeyRef.current !== fitKey;
    lastFitKeyRef.current = fitKey;

    const labels = [];
    let fitFrame = 0;

    // 清场：图层 → 数据源 → 运行时状态引用 → DOM 标注，顺序不能反
    const removeData = () => {
      for (const id of ALL_LAYERS) {
        if (map.getLayer(id)) map.removeLayer(id);
      }
      for (const id of [SOURCE_ID, FLOOR_SOURCE]) {
        if (map.getSource(id)) map.removeSource(id);
      }
      hoveredRef.current = null;
      selectedRef.current = null;
      linkedRef.current = null;
      labelsRef.current = [];
      updateLabelsRef.current = null;
      for (const item of labels) item.marker.remove();
      labels.length = 0;
    };

    removeData();
    setStats(null);

    if (!geojson?.features?.length) {
      onFloorReadyRef.current?.(null);
      return undefined;
    }

    const codeStats = analyzeCodes(geojson.features);
    // 先体检再落图：重复位号要写进 feature 属性，样式里的红色底才出得来
    const mapData = markDuplicates(geojson, codeStats.duplicated);

    // 楼板优先用显式上传的轮廓；缺失时由商铺外轮廓做形态学闭运算派生
    // （外扩 5m 黏连缝隙 → 内缩 5m 回到外缘 → 再外扩 0.5m 墙边距），失败则只画商铺
    let floorGeojson = isValidFloor(floor) ? floor : null;
    if (!floorGeojson) {
      try {
        floorGeojson = deriveFloorFromShops(geojson.features);
      } catch (err) {
        console.warn("楼板派生失败，仅显示商铺", err);
      }
    }
    // 把实际生效的轮廓回传给父组件：没有上传轮廓时，保存可直接复用，不必再算一次
    onFloorReadyRef.current?.(floorGeojson);

    // 楼板先加、商铺后加，保证商铺面覆盖在楼板之上
    if (floorGeojson) {
      map.addSource(FLOOR_SOURCE, { type: "geojson", data: floorGeojson });
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

    // promoteId 把 uid 提升为要素 id：setFeatureState / queryRenderedFeatures
    // 都按 "shop-12" 这种业务 id 定位，而不是随数据顺序变化的数组下标。
    map.addSource(SOURCE_ID, {
      type: "geojson",
      data: mapData,
      promoteId: "uid",
    });

    // 面层负责颜色和点击/hover 命中；描边单独一层，便于按状态加粗高亮
    map.addLayer({
      id: FILL_LAYER,
      type: "fill",
      source: SOURCE_ID,
      paint: {
        "fill-color": FILL_COLOR,
        "fill-opacity": 0.9,
      },
    });

    map.addLayer({
      id: OUTLINE_LAYER,
      type: "line",
      source: SOURCE_ID,
      paint: {
        "line-color": [
          "case",
          ["boolean", ["feature-state", "linked"], false],
          LINKED_COLOR,
          ["boolean", ["feature-state", "selected"], false],
          SELECTED_OUTLINE_COLOR,
          ["boolean", ["feature-state", "hover"], false],
          HOVER_OUTLINE_COLOR,
          ["==", ["get", "type"], AREA_TYPE.OBSTACLE],
          OBSTACLE_OUTLINE_COLOR,
          "#ffffff",
        ],
        "line-width": [
          "case",
          ["boolean", ["feature-state", "linked"], false],
          4,
          ["boolean", ["feature-state", "selected"], false],
          3.5,
          ["boolean", ["feature-state", "hover"], false],
          3,
          1.2,
        ],
      },
    });

    // 标注用 DOM Marker 而不是 symbol 图层：
    // 1) 需要"位号 + 商户名"两行、不同字号和省略号的排版；
    // 2) 需要在 JS 里手动避让，联动标注要能强制保留、允许压盖。
    mapData.features.forEach((feature, featureIndex) => {
      const props = feature.properties;
      // 障碍区是纯几何占位：不生成标注，也不参与标注避让
      if (isObstacleFeature(props)) return;

      const {
        uid,
        label,
        area_m2: area,
        [DUPLICATE_PROP]: isDuplicate,
      } = props;

      const type = areaTypeOf(props);
      const isShop = type === "shop";
      // code 去空格后决定显示真实位号还是走"未编号"回退
      const code = (props.code || "").trim();
      // 位号可能是 1F-101 / B1-101 等，直接显示完整值，不做前缀截断
      // centroid 用 labelPoint：凹形铺位（L 形）的几何重心可能落在铺位外，
      // 那里会退而取最近的"在多边形内"的网格采样点
      const item = {
        uid,
        area,
        type,
        // 商铺沿用"位号 + 商户名"两行；设施只显示类型图标徽标
        merchantName: isShop ? merchantNameOf(props) : "",
        centroid: labelPoint(feature.geometry),
        // codeText 为 null 时才走"未编号/#序号"回退；设施直接给名称，避免被编号回退覆盖
        codeText: isShop
          ? code
            ? label || code
            : null
          : (props.name || "").trim() || "未命名",
        index: featureIndex + 1,
      };
      const text = labelTextFor(item, showIndexRef.current);
      const el = document.createElement("div");
      el.className = isDuplicate
        ? `${shopLabelStyles.shopLabel} ${shopLabelStyles.isDuplicate}`
        : shopLabelStyles.shopLabel;
      renderShopLabel(el, text, item.merchantName, item.type);
      const marker = new Marker({ element: el, anchor: "center" })
        .setLngLat(item.centroid)
        .addTo(map);

      labels.push({
        ...item,
        el,
        marker,
        ...labelSize(text, item.merchantName, item.type),
      });
    });

    labelsRef.current = labels;

    const shopCount = geojson.features.filter(
      (feature) => areaTypeOf(feature.properties) === "shop",
    ).length;
    const obstacleCount = geojson.features.filter((feature) =>
      isObstacleFeature(feature.properties),
    ).length;
    // duplicate 是重复位号的种类数，duplicateShops 是红色铺位的实际数量；
    // count 只数商铺，设施和障碍区分开统计，避免统计卡把非营业面算成铺位
    setStats({
      count: shopCount,
      facilityCount: geojson.features.length - shopCount - obstacleCount,
      obstacleCount,
      normal: codeStats.normal,
      missing: codeStats.missing,
      duplicate: codeStats.duplicated.size,
      duplicateShops: codeStats.duplicateShops,
    });

    // 标注避让：move/resize 时重算，直接改 DOM 的 display/class，不走 React 渲染
    // —— 拖拽期间每帧都会跑，setState 会明显掉帧。
    // 优先级：联动 > hover > 面积大者；重叠时后来者隐藏，但联动标注强制显示。
    const updateLabels = () => {
      if (!mapRef.current) return;
      const zoom = map.getZoom();
      const width = map.getContainer().clientWidth;
      const height = map.getContainer().clientHeight;

      for (const item of labels) {
        item.el.classList.toggle(
          shopLabelStyles.isLinked,
          item.uid === linkedRef.current,
        );
      }

      // 低缩放时铺位只有几个像素宽，全量标注必然重叠：
      // 只留联动铺位，保证"表格 hover 哪行，地图上就能看到哪个铺位"
      if (zoom < LABEL_MIN_ZOOM) {
        for (const item of labels) {
          item.el.style.display =
            item.uid === linkedRef.current ? "" : "none";
        }
        return;
      }

      const ordered = labels
        .slice()
        .sort(
          (a, b) =>
            Number(b.uid === linkedRef.current) -
              Number(a.uid === linkedRef.current) ||
            Number(b.uid === hoveredRef.current) -
              Number(a.uid === hoveredRef.current) ||
            b.area - a.area,
        );
      const placed = [];

      for (const item of ordered) {
        const point = map.project(item.centroid);
        const boxWidth = item.width;
        const left = point.x - boxWidth / 2 - 2;
        const top = point.y - item.height / 2;
        const right = left + boxWidth + 4;
        const bottom = top + item.height;

        const isLinked = item.uid === linkedRef.current;
        let visible = right > 0 && left < width && bottom > 0 && top < height;

        if (visible && !isLinked) {
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

    updateLabelsRef.current = updateLabels;

    // hover 只改一个要素的 feature-state，颜色由 GPU 端表达式算，不重绘图层；
    // 随后刷一遍标注，让 hover 的标注获得避让优先级
    const setHover = (uid) => {
      if (uid === hoveredRef.current) return;
      if (hoveredRef.current) {
        map.setFeatureState(
          { source: SOURCE_ID, id: hoveredRef.current },
          { hover: false },
        );
      }
      hoveredRef.current = uid;
      if (uid) {
        map.setFeatureState({ source: SOURCE_ID, id: uid }, { hover: true });
      }
      map.getCanvas().style.cursor = uid ? "pointer" : "";
      updateLabels();
    };

    // 命中检测限定在填充层：楼板层不参与，点在楼板空白处不会误选
    const onMouseMove = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER],
      });
      setHover(features.length ? features[0].properties.uid : null);
    };

    const onMouseOut = () => setHover(null);

    // 点击回传给父组件打开商户编辑弹窗；字段做兜底，
    // 缺 label/code 的老数据也能以"未编号"进入编辑流程
    const onClick = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER],
      });
      if (!features.length) return;

      const props = features[0].properties;
      onShopClickRef.current?.({
        uid: props.uid,
        type: areaTypeOf(props),
        code: (props.code || "").trim(),
        label: props.label || areaLabelOf(props),
        merchantNo: props.merchantNo || "",
        merchantName: props.merchantName || "",
        name: (props.name || "").trim(),
        areaNo: (props.areaNo || "").trim(),
        toiletType: props.toiletType || "",
      });
    };

    map.on("move", updateLabels);
    map.on("resize", updateLabels);
    map.on("mousemove", onMouseMove);
    map.on("mouseout", onMouseOut);
    map.on("click", onClick);

    // 视野按"商铺 + 楼板"合并计算，只用商铺算会贴得太紧；
    // 48px padding 是为了避开左上角统计卡和右上角缩放按钮
    const bounds = featureBounds(
      floorGeojson?.features?.length
        ? [...geojson.features, ...floorGeojson.features]
        : geojson.features,
    );
    const fit = (duration) => {
      const camera = map.cameraForBounds(bounds, {
        padding: { top: 48, right: 48, bottom: 48, left: 48 },
        maxZoom: 20,
      });
      if (!camera) return;
      map.easeTo({
        center: camera.center,
        zoom: camera.zoom,
        pitch: 0,
        bearing: 0,
        duration,
      });
    };
    fitRef.current = () => fit(650);

    // 放到 rAF 里等卡片布局完成：挂载首帧容器高度可能还是 0，fit 会算出错误视野；
    // 换数据时用 0ms 直接跳转，不做动画
    if (isNewUpload) {
      fitFrame = requestAnimationFrame(() => fit(0));
    }
    // idle 后再刷一次标注：首次 updateLabels 时地图还没完成首帧渲染，
    // project() 得到的像素坐标可能不准
    map.once("idle", updateLabels);
    updateLabels();

    // 清理：地图已被整体卸载时直接跳过（不能再操作已 remove 的实例）；
    // 否则解绑全部监听并清掉本项目的数据，地图实例留给下一个 effect 复用
    return () => {
      if (!mapRef.current) return;
      cancelAnimationFrame(fitFrame);
      fitRef.current = null;
      map.off("move", updateLabels);
      map.off("resize", updateLabels);
      map.off("mousemove", onMouseMove);
      map.off("mouseout", onMouseOut);
      map.off("click", onClick);
      map.off("idle", updateLabels);
      removeData();
    };
  }, [geojson, floor, fitKey, mapReady]);

  // 联动铺位（对比面板 hover 表格行）→ 地图高亮。
  // 依赖里的 geojson 不能去掉：removeData 会把 source 和 linkedRef 一起清掉，
  // 这里是数据重建后唯一把联动状态写回去的地方；平时只做 prev→next 差量更新。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const next = linkedUid ?? null;
    const prev = linkedRef.current;
    if (prev !== next) {
      if (prev && map.getSource(SOURCE_ID)) {
        map.setFeatureState(
          { source: SOURCE_ID, id: prev },
          { linked: false },
        );
      }
      linkedRef.current = next;
      if (next && map.getSource(SOURCE_ID)) {
        map.setFeatureState(
          { source: SOURCE_ID, id: next },
          { linked: true },
        );
      }
    }
    updateLabelsRef.current?.();
  }, [linkedUid, geojson, mapReady]);

  // 对比模式开关：无位号铺位在"未编号"和"#序号"之间切换，
  // 文案变了标注盒宽度也变，要重算尺寸并重新跑避让
  useEffect(() => {
    showIndexRef.current = showUnnumberedIndex;
    for (const item of labelsRef.current) {
      const text = labelTextFor(item, showUnnumberedIndex);
      renderShopLabel(item.el, text, item.merchantName, item.type);
      const size = labelSize(text, item.merchantName, item.type);
      item.width = size.width;
      item.height = size.height;
    }
    updateLabelsRef.current?.();
  }, [showUnnumberedIndex, geojson]);

  // 选中状态（表格里正在编辑的行）→ 蓝色高亮。
  // 只写 feature-state，不刷标注：选中不参与避让优先级，颜色由 GPU 样式算。
  // 依赖里的 geojson 不能去掉：重建后由这里恢复选中态。
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const next = activeUid ?? null;
    const prev = selectedRef.current;
    if (prev === next) return;

    if (prev && map.getSource(SOURCE_ID)) {
      map.setFeatureState(
        { source: SOURCE_ID, id: prev },
        { selected: false },
      );
    }
    selectedRef.current = next;
    if (next && map.getSource(SOURCE_ID)) {
      map.setFeatureState(
        { source: SOURCE_ID, id: next },
        { selected: true },
      );
    }
  }, [activeUid, geojson, mapReady]);

  // fitRef 由主 effect 写入，闭包里持有最近一次计算的 bounds
  const fitAll = () => fitRef.current?.();

  return { containerRef, stats, fitAll };
}
