// 商铺/设施标注 DOM 渲染与尺寸估算：编辑器 / 编辑预览 / 导览图三处共用。
// 公共设施只显示设施图标徽标（可并排多个），商铺显示位号 + 可选商户名。
// 用 DOM API 拼内容而非 innerHTML，商户名里的 < > & 不会破坏结构。
import {
  FACILITY_LABEL_SIZE,
  createFacilityIconNode,
  facilityLabelWidth,
} from "./areaTypeIcons.js";
import { isFacilityType, labelWidth } from "./shopGeometry.js";
import styles from "./shopLabel.less";

// 可重入：同一 el 会反复调用（如切换"未编号/#序号"），用 classList 切换而非 className 覆盖
export function renderShopLabel(
  el,
  text,
  merchantName,
  type,
  facilityKinds = [],
  toiletType = "",
) {
  el.textContent = "";
  const facility = isFacilityType(type);
  el.classList.toggle(styles.iconOnly, facility);
  el.classList.toggle(styles.hasMerchant, Boolean(merchantName));

  const code = document.createElement("span");
  code.className = styles.shopLabelCode;
  if (facility) {
    // 没有具体设施项的历史数据用通用"公共设施"图标兜底
    const kinds = facilityKinds.length ? facilityKinds : [null];
    for (const kind of kinds) {
      const icon = createFacilityIconNode(kind, toiletType);
      if (icon) {
        icon.classList.add(styles.shopLabelIcon);
        code.appendChild(icon);
      }
    }
  } else {
    code.appendChild(document.createTextNode(text));
  }
  el.appendChild(code);

  if (merchantName) {
    const merchant = document.createElement("span");
    merchant.className = styles.shopLabelMerchant;
    merchant.textContent = merchantName;
    el.appendChild(merchant);
  }
  return el;
}

// 粗估标注盒尺寸（中文 10px、ASCII 6.4px 累加 + 12px 内边距），供像素级碰撞检测；
// MapLibre Marker 不暴露自身布局尺寸。设施徽标固定高 24px，宽度随并排图标数增长。
export function labelSize(text, merchantName, type, facilityKinds = []) {
  if (isFacilityType(type)) {
    return {
      width: facilityLabelWidth(facilityKinds.length),
      height: FACILITY_LABEL_SIZE,
    };
  }
  return {
    width: Math.max(labelWidth(text), merchantName ? labelWidth(merchantName) : 0),
    height: merchantName ? 34 : 22,
  };
}
