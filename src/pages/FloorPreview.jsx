import { useEffect, useState } from 'react';
import { Button, Card, Empty, Result, Space, Tag, Typography, message } from 'antd';
import { history, useParams } from 'umi';
import FloorPreviewMap from '../components/FloorPreviewMap.jsx';
import { deriveFloorFromShops } from '../lib/floorGeometry.js';
import { normalizeShopData } from '../lib/shopGeometry.js';
import { getMap, getMapGeoJson, getMapOutline } from '../services/maps.js';

function isValidOutline(value) {
  return (
    value?.type === 'FeatureCollection' &&
    Array.isArray(value.features) &&
    value.features.length > 0
  );
}

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

    Promise.all([
      getMap(floorId),
      getMapGeoJson(floorId),
      getMapOutline(floorId).catch(() => null),
    ])
      .then(([meta, raw, savedOutline]) => {
        if (!active) return;

        const normalized = normalizeShopData(raw);
        let floorGeojson = isValidOutline(savedOutline) ? savedOutline : null;
        if (!floorGeojson) {
          try {
            floorGeojson = deriveFloorFromShops(normalized.features);
          } catch (err) {
            console.warn('楼层轮廓派生失败，仅显示商铺', err);
          }
        }

        setFloor(meta);
        setShops(normalized);
        setOutline(floorGeojson);
      })
      .catch((err) => {
        if (!active) return;
        if (err.status !== 404) {
          message.error(err.message || '楼层加载失败');
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
      <div className="page-stack">
        <Card loading />
      </div>
    );
  }

  if (error || !floor) {
    return (
      <Result
        status={error?.status === 404 ? '404' : 'error'}
        title={error?.status === 404 ? '楼层不存在' : '楼层预览加载失败'}
        subTitle={
          error?.status === 404
            ? '该楼层可能已被删除，请返回列表重新选择。'
            : error?.message || '请稍后重试。'
        }
        extra={
          <Button type="primary" onClick={() => history.push('/floors')}>
            返回列表
          </Button>
        }
      />
    );
  }

  return (
    <div className="page-stack floor-preview-page">
      <div className="page-head">
        <div>
          <h1>
            {floor.name}{' '}
            <Typography.Text type="secondary">{floor.floorCode}</Typography.Text>
          </h1>
          <p>楼层地图只读预览 · 支持铺位间导航</p>
        </div>
        <Space>
          <Tag>只读</Tag>
          <Button onClick={() => history.push('/floors')}>返回列表</Button>
        </Space>
      </div>

      <Card className="floor-preview-card">
        {shops?.features?.length ? (
          <FloorPreviewMap shops={shops} floor={outline} />
        ) : (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description="该楼层暂未录入商铺地图数据"
            style={{ margin: 'auto', padding: '80px 0' }}
          />
        )}
      </Card>
    </div>
  );
}