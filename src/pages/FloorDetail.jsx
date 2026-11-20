import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Col,
  Descriptions,
  Empty,
  Result,
  Row,
  Tag,
  Typography,
  message,
} from 'antd';
import { history, useParams } from 'umi';
import { getMap } from '../services/maps.js';

const formatTime = (value) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

export default function FloorDetail() {
  const { floorId } = useParams();
  const [floor, setFloor] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let active = true;
    setLoading(true);
    getMap(floorId)
      .then((data) => {
        if (active) setFloor(data);
      })
      .catch((error) => {
        if (!active) return;
        if (error.status !== 404) {
          message.error(error.message || '楼层加载失败');
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [floorId]);

  if (loading) {
    return <Card loading />;
  }

  if (!floor) {
    return (
      <Result
        status="404"
        title="楼层不存在"
        subTitle="该楼层可能已被删除，请返回列表重新选择。"
        extra={
          <Button type="primary" onClick={() => history.push('/floors')}>
            返回列表
          </Button>
        }
      />
    );
  }

  return (
    <div className="page-stack">
      <div className="page-head">
        <div>
          <h1>
            {floor.name} <Typography.Text type="secondary">{floor.floorCode}</Typography.Text>
          </h1>
          <p>楼层详情</p>
        </div>
        <Button onClick={() => history.push('/floors')}>返回列表</Button>
      </div>

      <Card title="楼层信息">
        <Descriptions bordered column={2}>
          <Descriptions.Item label="楼层编号">{floor.floorCode}</Descriptions.Item>
          <Descriptions.Item label="楼层名称">{floor.name}</Descriptions.Item>
          <Descriptions.Item label="版本">{`v${floor.version}`}</Descriptions.Item>
          <Descriptions.Item label="铺位数量">{`${floor.unitCount} 个`}</Descriptions.Item>
          <Descriptions.Item label="要素数量">{`${floor.featureCount} 个`}</Descriptions.Item>
          <Descriptions.Item label="已绑定商铺">{`${floor.shopCount} 家`}</Descriptions.Item>
          <Descriptions.Item label="已落位商铺">{`${floor.placedShopCount} 家`}</Descriptions.Item>
          <Descriptions.Item label="未落位商铺">{`${floor.unplacedShopCount} 家`}</Descriptions.Item>
          <Descriptions.Item label="楼层轮廓">
            <Tag color={floor.hasOutline ? 'green' : 'default'}>
              {floor.hasOutline ? '已录入' : '未录入'}
            </Tag>
          </Descriptions.Item>
          <Descriptions.Item label="创建时间">{formatTime(floor.createdAt)}</Descriptions.Item>
          <Descriptions.Item label="更新时间">{formatTime(floor.updatedAt)}</Descriptions.Item>
        </Descriptions>
      </Card>

      <Row gutter={16}>
        <Col xs={24} md={12}>
          <Card title="商铺管理" className="placeholder-card">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="商铺台账功能待建设" />
          </Card>
        </Col>
        <Col xs={24} md={12}>
          <Card title="楼层图纸" className="placeholder-card">
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="图纸上传与预览待建设" />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
