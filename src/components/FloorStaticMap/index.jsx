import useStaticMap from "./useStaticMap.js";
import styles from "./FloorStaticMap.less";

export default function FloorStaticMap({ shops, floor }) {
  const { containerRef } = useStaticMap({ shops, floor });

  return (
    <div className={styles.mapWrap}>
      <div ref={containerRef} className={styles.map} />
    </div>
  );
}
