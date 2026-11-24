// 区域类型图标：同一份图形数据同时供 React（AreaTypeSelect/icons.jsx）
// 和地图标注（纯 DOM 的 createAreaTypeIconNode）使用，避免两处各写一套 path。
import { AREA_TYPE } from './shopGeometry.js';

export const AREA_ICON_BASE_PROPS = {
  width: '1em',
  height: '1em',
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.7,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  focusable: 'false',
  'aria-hidden': true,
};

export const AREA_TYPE_ICON_SHAPES = {
  [AREA_TYPE.SHOP]: [
    { tag: 'path', d: 'M4.5 9.5V20h15V9.5' },
    {
      tag: 'path',
      d: 'M3 9.5 4.9 4h14.2L21 9.5a2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0 2.25 2.25 0 0 1-4.5 0Z',
    },
    { tag: 'path', d: 'M9.5 20v-4.5h5V20' },
  ],
  [AREA_TYPE.ELEVATOR]: [
    { tag: 'rect', x: 4.5, y: 3, width: 15, height: 18, rx: 1.8 },
    { tag: 'path', d: 'M12 3v18' },
    { tag: 'path', d: 'M8.2 10.5v-5M8.2 5.5 6.7 7M8.2 5.5 9.7 7' },
    { tag: 'path', d: 'M15.8 13.5v5M15.8 18.5l-1.5-1.5M15.8 18.5l1.5-1.5' },
  ],
  [AREA_TYPE.TOILET]: [
    { tag: 'circle', cx: 6.7, cy: 4.8, r: 1.7 },
    { tag: 'path', d: 'M6.7 6.5v6.2' },
    { tag: 'path', d: 'M6.7 8.2 4.8 10.1M6.7 8.2l1.9 1.9' },
    { tag: 'path', d: 'M6.7 12.7 5.2 19.8M6.7 12.7l1.5 7.1' },
    { tag: 'circle', cx: 17.3, cy: 4.8, r: 1.7 },
    { tag: 'path', d: 'M17.3 6.5 14.9 13h4.8Z' },
    { tag: 'path', d: 'M17.3 13v3.4M17.3 16.4l-1.5 3.4M17.3 16.4l1.5 3.4' },
  ],
  [AREA_TYPE.NURSING]: [
    {
      tag: 'path',
      d: 'M9.3 8.2h5.4v9.6a2.2 2.2 0 0 1-2.2 2.2h-1a2.2 2.2 0 0 1-2.2-2.2Z',
    },
    { tag: 'path', d: 'M9.9 8.2V6.5h4.2v1.7' },
    { tag: 'path', d: 'M11 6.5V4.2h2v2.3' },
    { tag: 'path', d: 'M11.6 3.2h.8' },
    { tag: 'path', d: 'M9.3 11.4h5.4M9.3 14.6h5.4' },
  ],
  [AREA_TYPE.OBSTACLE]: [
    { tag: 'rect', x: 3.5, y: 6, width: 17, height: 12, rx: 1 },
    { tag: 'path', d: 'M3.5 10.5h17M3.5 14.5h17' },
    { tag: 'path', d: 'M8.2 6v4.5M15.8 6v4.5M12 10.5V15M8.2 15v3M15.8 15v3' },
  ],
};

const SVG_NS = 'http://www.w3.org/2000/svg';
// 设施图标徽标的直径，需与三处 CSS（导览图/编辑预览/全屏编辑器）的 iconOnly 尺寸一致
export const FACILITY_LABEL_SIZE = 24;
// 数据里用 React 的驼峰写法（strokeWidth），落到 DOM 时要转成 SVG 属性名；
// viewBox 是大小写敏感的既有属性名，不能转
const DOM_ATTRIBUTE_NAMES = { viewBox: 'viewBox' };
const attrNameOf = (name) =>
  DOM_ATTRIBUTE_NAMES[name] ??
  name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);

export function createAreaTypeIconNode(type) {
  const shapes = AREA_TYPE_ICON_SHAPES[type];
  if (!shapes) return null;

  const svg = document.createElementNS(SVG_NS, 'svg');
  for (const [name, value] of Object.entries(AREA_ICON_BASE_PROPS)) {
    svg.setAttribute(attrNameOf(name), String(value));
  }
  for (const { tag, ...attrs } of shapes) {
    const node = document.createElementNS(SVG_NS, tag);
    for (const [name, value] of Object.entries(attrs)) {
      node.setAttribute(attrNameOf(name), String(value));
    }
    svg.appendChild(node);
  }
  return svg;
}
