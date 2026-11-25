import React from "react";
import { AREA_TYPE, FACILITY_KIND } from "../../lib/shopGeometry.js";
import {
  AREA_ICON_BASE_PROPS,
  AREA_TYPE_ICON_SHAPES,
  PUBLIC_FACILITY_ICON_SHAPES,
  TOILET_ICON_SHAPES,
} from "../../lib/areaTypeIcons.js";

const IconShapes = ({ shapes, ...props }) => (
  <svg {...AREA_ICON_BASE_PROPS} {...props}>
    {shapes.map(({ tag: Tag, ...attrs }, index) => (
      <Tag key={index} {...attrs} />
    ))}
  </svg>
);

const AreaTypeIcon = ({ type, ...props }) => (
  <IconShapes shapes={AREA_TYPE_ICON_SHAPES[type]} {...props} />
);

export const ShopIcon = (props) => <AreaTypeIcon type={AREA_TYPE.SHOP} {...props} />;

export const PublicFacilityIcon = (props) => (
  <IconShapes shapes={PUBLIC_FACILITY_ICON_SHAPES} {...props} />
);

export const ElevatorIcon = (props) => (
  <AreaTypeIcon type={FACILITY_KIND.ELEVATOR} {...props} />
);

export const MaleToiletIcon = (props) => (
  <IconShapes shapes={TOILET_ICON_SHAPES.male} {...props} />
);

export const FemaleToiletIcon = (props) => (
  <IconShapes shapes={TOILET_ICON_SHAPES.female} {...props} />
);

export const BothToiletIcon = (props) => (
  <IconShapes shapes={TOILET_ICON_SHAPES.both} {...props} />
);

export const NursingIcon = (props) => (
  <AreaTypeIcon type={FACILITY_KIND.NURSING} {...props} />
);

export const ObstacleIcon = (props) => (
  <AreaTypeIcon type={AREA_TYPE.OBSTACLE} {...props} />
);
