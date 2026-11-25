import React, { Fragment } from "react";
import styles from "./index.less";

const ROLE_LABEL = {
  start: "起点",
  end: "终点",
  transfer: "换乘",
};

export default function RouteFloorSteps({
  steps = [],
  activeFloorId,
  onChangeFloor,
}) {
  if (!steps.length) return null;

  return (
    <div className={styles.steps} role="group" aria-label="路线楼层">
      {steps.map((step, index) => (
        <Fragment key={step.floorId}>
          {index > 0 && (
            <span className={styles.connector} aria-hidden="true">
              {step.connectorLabel || "·"}
            </span>
          )}
          <button
            type="button"
            className={`${styles.step} ${
              step.floorId === activeFloorId ? styles.active : ""
            }`}
            aria-current={step.floorId === activeFloorId ? "step" : undefined}
            onClick={() => onChangeFloor?.(step.floorId)}
          >
            <span className={styles.floor}>{step.floorCode}</span>
            <span className={styles.role}>{ROLE_LABEL[step.role] || step.role}</span>
            {step.label ? <span className={styles.label}>{step.label}</span> : null}
          </button>
        </Fragment>
      ))}
    </div>
  );
}
