import useStaticMap from "./useStaticMap.js";
import styles from "./FloorStaticMap.less";

export default function FloorStaticMap({
  shops,
  floor,
  route = null,
  pins = [],
  fitPaddingBottom = 0,
}) {
  const { containerRef } = useStaticMap({
    shops,
    floor,
    route,
    pins,
    fitPaddingBottom,
  });

  return (
    <div className={styles.mapWrap}>
      <div ref={containerRef} className={styles.map} />
    </div>
  );
}
