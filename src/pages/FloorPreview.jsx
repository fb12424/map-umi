import { useEffect, useState } from "react";
import {
  Button,
  Card,
  Empty,
  Result,
  message,
} from "antd";
import { history, useParams } from "umi";
import FloorGuideMap from "../components/FloorGuideMap/index.jsx";
import { loadFloorScene } from "../lib/floorScene.js";
import pageStyles from "../styles/page.less";
import styles from "./FloorPreview.less";
import { LeftOutlined } from "@ant-design/icons";

export default function FloorPreview() {
  const { floorId } = useParams();
  const [floor, setFloor] = useState(null);
  const [shops, setShops] = useState(null);
  const [outline, setOutline] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError(null);
    setFloor(null);
    setShops(null);
    setOutline(null);

    loadFloorScene(floorId)
      .then((scene) => {
        if (!active) return;

        setFloor(scene.meta);
        setShops(scene.shops);
        setOutline(scene.floor);
      })
      .catch((err) => {
        if (!active) return;
        if (err.status !== 404) {
          message.error(err.message || "楼层加载失败");
        }
        setError(err);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [floorId, message]);

  if (loading) {
    return (
      <div className={pageStyles.pageStack}>
        <Card loading />
      </div>
    );
  }

  if (error || !floor) {
    return (
      <Result
        status={error?.status === 404 ? "404" : "error"}
        title={error?.status === 404 ? "楼层不存在" : "楼层预览加载失败"}
        subTitle={
          error?.status === 404
            ? "该楼层可能已被删除，请返回列表重新选择。"
            : error?.message || "请稍后重试。"
        }
        extra={
          <Button type="primary" onClick={() => history.push("/floors")}>
            返回列表
          </Button>
        }
      />
    );
  }

  return (
    <div className={`${pageStyles.pageStack} ${styles.floorPreviewPage}`}>
      <Card
        size="small"
        className={styles.floorPreviewCard}
        title={"导航预览"}
        extra={
          <Button
            size="small"
            type="link"
            icon={<LeftOutlined />}
            onClick={() => history.push("/floors")}
          >
            返回列表
          </Button>
        }
      >
        {shops?.features?.length ? (
          <FloorGuideMap shops={shops} floor={outline} />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该楼层暂未录入商铺地图数据"
            style={{ margin: "auto", padding: "80px 0" }}
          />
        )}
      </Card>
    </div>
  );
}

