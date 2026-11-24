import React from "react";
import styles from "./index.less";

const AreaTypeSelect = ({ value, options = [], onChange, id }) => {
  const handleSelect = (next) => {
    if (next === value) return;
    onChange?.(next);
  };

  return (
    <div id={id} className={styles.area} role="radiogroup">
      {options.map((option) => {
        const active = option.value === value;
        return (
          <div
            key={option.value}
            role="radio"
            aria-checked={active}
            tabIndex={0}
            className={`${styles.areaItem}${
              active ? ` ${styles.areaItemActive}` : ""
            }`}
            onClick={() => handleSelect(option.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                handleSelect(option.value);
              }
            }}
          >
            {option.icon && (
              <span className={styles.areaIcon}>{option.icon}</span>
            )}
            <span className={styles.areaLabel}>{option.label}</span>
          </div>
        );
      })}
    </div>
  );
};

export default AreaTypeSelect;
