import { useEffect, useRef, useState } from 'react';
import {
  AttributionControl,
  LngLatBounds,
  Map as MapLibreMap,
  Marker,
  NavigationControl,
} from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import { deriveFloorFromShops } from '../lib/floorGeometry.js';
import {
  findDuplicateCodes,
  labelPoint,
  labelWidth,
  shortLabel,
} from '../lib/shopGeometry.js';
import './FloorMapPreview.css';

const SOURCE_ID = 'preview-shops';
const FLOOR_SOURCE = 'preview-floor';
const FILL_LAYER = 'preview-shops-fill';
const OUTLINE_LAYER = 'preview-shops-outline';
const FLOOR_FILL_LAYER = 'preview-floor-fill';
const ALL_LAYERS = [FILL_LAYER, OUTLINE_LAYER, FLOOR_FILL_LAYER];
const LABEL_MIN_ZOOM = 16.3;

const CORRIDOR_COLOR = '#f4e5c9';
const HOVER_COLOR = '#f2a33a';
const SELECTED_COLOR = '#2563eb';
const LINKED_COLOR = '#0ea5e9';
const DUPLICATE_COLOR = '#dc2626';
const DUPLICATE_PROP = 'duplicate_code';

const AREA_COLOR = [
  'step',
  ['coalesce', ['get', 'area_m2'], 0],
  '#c3d9f2',
  30, '#98bde8',
  60, '#6597d7',
  120, '#3c72bb',
  200, '#1d4a8f',
];

const FILL_COLOR = [
  'case',
  ['boolean', ['feature-state', 'linked'], false],
  LINKED_COLOR,
  ['boolean', ['feature-state', 'selected'], false],
  SELECTED_COLOR,
  ['boolean', ['feature-state', 'hover'], false],
  HOVER_COLOR,
  ['boolean', ['get', DUPLICATE_PROP], false],
  DUPLICATE_COLOR,
  AREA_COLOR,
];

function analyzeCodes(features) {
  const duplicated = new Set(findDuplicateCodes(features));
  let normal = 0;
  let missing = 0;

  for (const feature of features) {
    const code = (feature.properties?.code || '').trim();
    if (!code) missing += 1;
    else if (!duplicated.has(code)) normal += 1;
  }

  return { normal, missing, duplicated };
}

function markDuplicates(geojson, duplicated) {
  if (!duplicated.size) return geojson;
  return {
    ...geojson,
    features: geojson.features.map((feature) =>
      duplicated.has((feature.properties?.code || '').trim())
        ? {
            ...feature,
            properties: { ...feature.properties, [DUPLICATE_PROP]: true },
          }
        : feature,
    ),
  };
}

function featureBounds(features) {
  const bounds = new LngLatBounds();
  const walk = (coords) => {
    if (typeof coords[0] === 'number') {
      bounds.extend(coords);
      return;
    }
    coords.forEach(walk);
  };
  for (const feature of features) walk(feature.geometry.coordinates);
  return bounds;
}

const labelTextFor = (item, showUnnumberedIndex) => {
  if (item.codeText !== null) return item.codeText;
  return showUnnumberedIndex && item.index !== null
    ? `#${item.index}`
    : '未编号';
};

const merchantNameOf = (properties) =>
  (properties.merchantName || properties.shopName || properties.brand || '').trim();

function renderLabelContent(el, text, merchantName) {
  el.textContent = '';

  const code = document.createElement('span');
  code.className = 'shop-label-code';
  code.textContent = text;
  el.appendChild(code);

  el.classList.toggle('has-merchant', Boolean(merchantName));
  if (!merchantName) return;

  const merchant = document.createElement('span');
  merchant.className = 'shop-label-merchant';
  merchant.textContent = merchantName;
  el.appendChild(merchant);
}

function labelSize(text, merchantName) {
  return {
    width: Math.max(labelWidth(text), merchantName ? labelWidth(merchantName) : 0),
    height: merchantName ? 34 : 22,
  };
}

export default function FloorMapPreview({
  geojson,
  fitKey,
  activeUid = null,
  linkedUid = null,
  showUnnumberedIndex = false,
  onShopClick,
  onFloorReady,
}) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const fitRef = useRef(null);
  const hoveredRef = useRef(null);
  const selectedRef = useRef(null);
  const linkedRef = useRef(null);
  const linkedUidRef = useRef(linkedUid);
  const activeUidRef = useRef(activeUid);
  const showIndexRef = useRef(showUnnumberedIndex);
  const labelsRef = useRef([]);
  const updateLabelsRef = useRef(null);
  const lastFitKeyRef = useRef(null);
  const onShopClickRef = useRef(onShopClick);
  const onFloorReadyRef = useRef(onFloorReady);
  const [mapReady, setMapReady] = useState(false);
  const [stats, setStats] = useState(null);

  useEffect(() => {
    onShopClickRef.current = onShopClick;
    onFloorReadyRef.current = onFloorReady;
  });

  useEffect(() => {
    const map = new MapLibreMap({
      container: containerRef.current,
      style: {
        version: 8,
        sources: {},
        layers: [
          {
            id: 'background',
            type: 'background',
            paint: { 'background-color': '#eef1f6' },
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
      'top-right',
    );
    map.addControl(
      new AttributionControl({
        compact: true,
        customAttribution: '数据：本地上传 · WGS84',
      }),
      'bottom-right',
    );

    if (map.isStyleLoaded()) {
      setMapReady(true);
    } else {
      map.on('load', () => setMapReady(true));
    }

    return () => {
      map.remove();
      mapRef.current = null;
      setMapReady(false);
    };
  }, []);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return undefined;

    const isNewUpload = lastFitKeyRef.current !== fitKey;
    lastFitKeyRef.current = fitKey;

    const labels = [];
    let fitFrame = 0;

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
    const mapData = markDuplicates(geojson, codeStats.duplicated);

    let floorGeojson = null;
    try {
      floorGeojson = deriveFloorFromShops(geojson.features);
    } catch (err) {
      console.warn('楼板派生失败，仅显示商铺', err);
    }
    onFloorReadyRef.current?.(floorGeojson);

    if (floorGeojson) {
      map.addSource(FLOOR_SOURCE, { type: 'geojson', data: floorGeojson });
      map.addLayer({
        id: FLOOR_FILL_LAYER,
        type: 'fill',
        source: FLOOR_SOURCE,
        paint: {
          'fill-color': CORRIDOR_COLOR,
          'fill-opacity': 1,
        },
      });
    }

    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: mapData,
      promoteId: 'uid',
    });

    if (activeUidRef.current) {
      map.setFeatureState(
        { source: SOURCE_ID, id: activeUidRef.current },
        { selected: true },
      );
      selectedRef.current = activeUidRef.current;
    }

    if (linkedUidRef.current) {
      map.setFeatureState(
        { source: SOURCE_ID, id: linkedUidRef.current },
        { linked: true },
      );
      linkedRef.current = linkedUidRef.current;
    }

    map.addLayer({
      id: FILL_LAYER,
      type: 'fill',
      source: SOURCE_ID,
      paint: {
        'fill-color': FILL_COLOR,
        'fill-opacity': 0.9,
      },
    });

    map.addLayer({
      id: OUTLINE_LAYER,
      type: 'line',
      source: SOURCE_ID,
      paint: {
        'line-color': [
          'case',
          ['boolean', ['feature-state', 'linked'], false],
          LINKED_COLOR,
          ['boolean', ['feature-state', 'selected'], false],
          '#1d4ed8',
          ['boolean', ['feature-state', 'hover'], false],
          '#f97316',
          '#ffffff',
        ],
        'line-width': [
          'case',
          ['boolean', ['feature-state', 'linked'], false],
          4,
          ['boolean', ['feature-state', 'selected'], false],
          3.5,
          ['boolean', ['feature-state', 'hover'], false],
          3,
          1.2,
        ],
      },
    });

    for (const feature of mapData.features) {
      const { uid, label, area_m2: area, [DUPLICATE_PROP]: isDuplicate } = feature.properties;

      const code = (feature.properties.code || '').trim();
      const rawIndex = Number(uid.slice('shop-'.length));
      const item = {
        uid,
        area,
        merchantName: merchantNameOf(feature.properties),
        centroid: labelPoint(feature.geometry),
        codeText: code ? shortLabel(label) : null,
        index: Number.isInteger(rawIndex) ? rawIndex + 1 : null,
      };
      const text = labelTextFor(item, showIndexRef.current);
      const el = document.createElement('div');
      el.className = isDuplicate ? 'shop-label is-duplicate' : 'shop-label';
      renderLabelContent(el, text, item.merchantName);
      const marker = new Marker({ element: el, anchor: 'center' })
        .setLngLat(item.centroid)
        .addTo(map);

      labels.push({
        ...item,
        el,
        marker,
        ...labelSize(text, item.merchantName),
      });
    }

    labelsRef.current = labels;

    setStats({
      count: geojson.features.length,
      normal: codeStats.normal,
      missing: codeStats.missing,
      duplicate: codeStats.duplicated.size,
    });

    const updateLabels = () => {
      if (!mapRef.current) return;
      const zoom = map.getZoom();
      const width = map.getContainer().clientWidth;
      const height = map.getContainer().clientHeight;

      for (const item of labels) {
        item.el.classList.toggle('is-linked', item.uid === linkedRef.current);
      }

      if (zoom < LABEL_MIN_ZOOM) {
        for (const item of labels) {
          item.el.style.display =
            item.uid === linkedRef.current ? '' : 'none';
        }
        return;
      }

      const ordered = labels
        .slice()
        .sort(
          (a, b) =>
            Number(b.uid === linkedRef.current) - Number(a.uid === linkedRef.current) ||
            Number(b.uid === hoveredRef.current) - Number(a.uid === hoveredRef.current) ||
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
            if (left < box.right && right > box.left && top < box.bottom && bottom > box.top) {
              visible = false;
              break;
            }
          }
        }

        item.el.style.display = visible ? '' : 'none';
        if (visible) placed.push({ left, right, top, bottom });
        item.el.classList.toggle('is-active', item.uid === hoveredRef.current);
      }
    };

    updateLabelsRef.current = updateLabels;

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
      map.getCanvas().style.cursor = uid ? 'pointer' : '';
      updateLabels();
    };

    const onMouseMove = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER],
      });
      setHover(features.length ? features[0].properties.uid : null);
    };

    const onMouseOut = () => setHover(null);

    const onClick = (event) => {
      const features = map.queryRenderedFeatures(event.point, {
        layers: [FILL_LAYER],
      });
      if (!features.length) return;

      const props = features[0].properties;
      onShopClickRef.current?.({
        uid: props.uid,
        code: (props.code || '').trim(),
        label: props.label || props.code || '未编号',
        merchantNo: props.merchantNo || '',
        merchantName: props.merchantName || '',
      });
    };

    map.on('move', updateLabels);
    map.on('resize', updateLabels);
    map.on('mousemove', onMouseMove);
    map.on('mouseout', onMouseOut);
    map.on('click', onClick);

    const bounds = featureBounds(geojson.features);
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

    if (isNewUpload) {
      fitFrame = requestAnimationFrame(() => fit(0));
    }
    map.once('idle', updateLabels);
    updateLabels();

    return () => {
      if (!mapRef.current) return;
      cancelAnimationFrame(fitFrame);
      fitRef.current = null;
      map.off('move', updateLabels);
      map.off('resize', updateLabels);
      map.off('mousemove', onMouseMove);
      map.off('mouseout', onMouseOut);
      map.off('click', onClick);
      map.off('idle', updateLabels);
      removeData();
    };
  }, [geojson, fitKey, mapReady]);

  useEffect(() => {
    activeUidRef.current = activeUid;
  }, [activeUid]);

  useEffect(() => {
    linkedUidRef.current = linkedUid ?? null;
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const next = linkedUid ?? null;
    const prev = linkedRef.current;
    if (prev !== next) {
      if (prev && map.getSource(SOURCE_ID)) {
        map.setFeatureState({ source: SOURCE_ID, id: prev }, { linked: false });
      }
      linkedRef.current = next;
      if (next && map.getSource(SOURCE_ID)) {
        map.setFeatureState({ source: SOURCE_ID, id: next }, { linked: true });
      }
    }
    updateLabelsRef.current?.();
  }, [linkedUid, geojson, mapReady]);

  useEffect(() => {
    showIndexRef.current = showUnnumberedIndex;
    for (const item of labelsRef.current) {
      const text = labelTextFor(item, showUnnumberedIndex);
      renderLabelContent(item.el, text, item.merchantName);
      const size = labelSize(text, item.merchantName);
      item.width = size.width;
      item.height = size.height;
    }
    updateLabelsRef.current?.();
  }, [showUnnumberedIndex, geojson]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;

    const next = activeUid ?? null;
    const prev = selectedRef.current;
    if (prev === next) return;

    if (prev && map.getSource(SOURCE_ID)) {
      map.setFeatureState({ source: SOURCE_ID, id: prev }, { selected: false });
    }
    selectedRef.current = next;
    if (next && map.getSource(SOURCE_ID)) {
      map.setFeatureState({ source: SOURCE_ID, id: next }, { selected: true });
    }
  }, [activeUid, geojson, mapReady]);

  return (
    <div className="preview-map-wrap">
      <div ref={containerRef} className="preview-map" />

      {stats && (
        <div className="preview-map-summary">
          <div>
            <strong>{stats.count}</strong> 间铺位
          </div>
          <div className="preview-map-code-stats">
            <span>
              正常位号 <strong>{stats.normal}</strong>
            </span>
            <span className={stats.missing ? 'is-warning' : ''}>
              无位号 <strong>{stats.missing}</strong>
            </span>
            <span className={stats.duplicate ? 'is-danger' : ''}>
              重复位号 <strong>{stats.duplicate}</strong>
            </span>
          </div>
          {stats.duplicate > 0 && (
            <div className="preview-map-legend">
              <i aria-hidden="true" />
              红色铺位为重复位号
            </div>
          )}
        </div>
      )}

      <div className="preview-map-toolbar">
        <button
          type="button"
          className="preview-fit"
          onClick={() => fitRef.current?.()}
        >
          适配全图
        </button>
      </div>
    </div>
  );
}
