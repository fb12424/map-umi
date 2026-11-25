// 楼层编号是自由文本：1F/3F 取正，B2、-1F 取负；解析不出数字的排到最后
export function floorLevel(code) {
  const match = /^\s*([Bb])?\s*(-)?\s*(\d+)/.exec(String(code ?? ""));
  if (!match) return null;
  const value = Number(match[3]);
  return match[1] || match[2] ? -value : value;
}

export function compareFloors(a, b) {
  const levelA = floorLevel(a.floorCode);
  const levelB = floorLevel(b.floorCode);
  if (levelA !== null && levelB !== null && levelA !== levelB) {
    return levelA - levelB;
  }
  if (levelA === null && levelB !== null) return 1;
  if (levelA !== null && levelB === null) return -1;
  return String(a.floorCode ?? "").localeCompare(String(b.floorCode ?? ""), "zh-CN", {
    numeric: true,
  });
}

export function compareMerchants(a, b) {
  return (
    compareFloors(a, b) ||
    String(a.brandName ?? "").localeCompare(String(b.brandName ?? ""), "zh-CN") ||
    String(a.boothCode ?? "").localeCompare(
      String(b.boothCode ?? ""),
      "zh-CN",
      { numeric: true },
    )
  );
}

export function merchantLabel(merchant) {
  const brand = String(merchant?.brandName ?? "").trim();
  const floor = String(merchant?.floorCode ?? "").trim();
  if (brand && floor) return `${brand} · ${floor}`;
  return brand || floor || "未命名商户";
}

export function merchantSearchText(merchant) {
  return [
    merchant?.brandName,
    merchant?.floorCode,
    merchant?.boothCode,
    merchant?.departmentCode,
  ]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(" ");
}

function normalizeFloorCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

export function isCrossFloor(start, end) {
  if (!start || !end) return false;
  return (
    normalizeFloorCode(start.floorCode) !== normalizeFloorCode(end.floorCode)
  );
}

export const FACILITY_OPTIONS = [
  { value: "toilet-male", label: "男厕所" },
  { value: "toilet-female", label: "女厕所" },
  { value: "toilet-both", label: "厕所" },
  { value: "elevator", label: "电梯" },
  { value: "nursing", label: "母婴室" },
];

export function facilityLabel(kind) {
  return FACILITY_OPTIONS.find((option) => option.value === kind)?.label || "设施";
}
