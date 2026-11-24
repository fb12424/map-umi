import React from "react";
import { AREA_TYPE } from "../../lib/shopGeometry.js";
import {
  AREA_ICON_BASE_PROPS,
  AREA_TYPE_ICON_SHAPES,
} from "../../lib/areaTypeIcons.js";

const AreaTypeIcon = ({ type, ...props }) => (
  <svg {...AREA_ICON_BASE_PROPS} {...props}>
    {AREA_TYPE_ICON_SHAPES[type].map(({ tag: Tag, ...attrs }, index) => (
      <Tag key={index} {...attrs} />
    ))}
  </svg>
);

export const ShopIcon = (props) => <AreaTypeIcon type={AREA_TYPE.SHOP} {...props} />;

export const ElevatorIcon = (props) => (
  <AreaTypeIcon type={AREA_TYPE.ELEVATOR} {...props} />
);

export const ToiletIcon = (props) => (
  <AreaTypeIcon type={AREA_TYPE.TOILET} {...props} />
);

export const NursingIcon = (props) => (
  <AreaTypeIcon type={AREA_TYPE.NURSING} {...props} />
);

export const ObstacleIcon = (props) => (
  <AreaTypeIcon type={AREA_TYPE.OBSTACLE} {...props} />
);
