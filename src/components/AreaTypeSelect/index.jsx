import React from "react";
import styles from "./index.less";

const AreaTypeSelect = ({
  value,
  options = [],
  onChange,
  id,
  multiple = false,
}) => {
  const isActive = (optionValue) =>
    multiple
      ? Array.isArray(value) && value.includes(optionValue)
      : optionValue === value;

  const handleSelect = (next) => {
    if (!multiple) {
      if (next === value) return;
      onChange?.(next);
      return;
    }

    const current = Array.isArray(value) ? value : [];
    onChange?.(
      current.includes(next)
        ? current.filter((item) => item !== next)
        : [...current, next],
    );
  };

  return (
    <div
      id={id}
      className={styles.area}
      role={multiple ? "group" : "radiogroup"}
    >
      {options.map((option) => {
        const active = isActive(option.value);
        return (
          <div
            key={option.value}
            role={multiple ? "checkbox" : "radio"}
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
