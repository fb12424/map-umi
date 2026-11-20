import { useEffect, useState } from 'react';
import {
  Button,
  Card,
  Empty,
  Popconfirm,
  Space,
  Table,
  Typography,
  message,
} from 'antd';
import { history } from 'umi';
import { deleteMap, listMaps } from '../services/maps.js';

const formatTime = (value) =>
  value ? new Date(value).toLocaleString('zh-CN', { hour12: false }) : '—';

export default function FloorList() {
  const [floors, setFloors] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try {
      setFloors(await listMaps());
    } catch (error) {
      message.error(error.message || '楼层加载失败');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const handleDelete = async (record) => {
    try {
      await deleteMap(record.id);
      message.success(`已删除「${record.name}」`);
      await load();
    } catch (error) {
      message.error(error.message || '删除失败');
    }
  };

  const columns = [
    {
      title: '楼层编号',
      dataIndex: 'floorCode',
      width: 120,
    },
    {
      title: '楼层名称',
      dataIndex: 'name',
    },
    {
      title: '铺位数量',
      dataIndex: 'unitCount',
      width: 110,
      render: (value) =>
        value === null || value === undefined ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          `${value} 个`
        ),
    },
    {
      title: '已绑定商铺',
      dataIndex: 'shopCount',
      width: 120,
      render: (value) =>
        value === null || value === undefined ? (
          <Typography.Text type="secondary">—</Typography.Text>
        ) : (
          `${value} 家`
        ),
    },
    {
      title: '版本',
      dataIndex: 'version',
      width: 80,
      render: (value) => `v${value}`,
    },
    {
      title: '更新时间',
      dataIndex: 'updatedAt',
      width: 190,
      render: formatTime,
    },
    {
      title: '操作',
      key: 'actions',
      width: 180,
      render: (_, record) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={() => history.push(`/floors/${record.id}/preview`)}
          >
            预览
          </Button>
          <Button type="link" size="small" onClick={() => history.push(`/floors/${record.id}/edit`)}>
            编辑
          </Button>
          <Popconfirm
            title={`确认删除「${record.name}」？`}
            okText="删除"
            okButtonProps={{ danger: true }}
            cancelText="取消"
            onConfirm={() => handleDelete(record)}
          >
            <Button type="link" size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div className="page-stack">
      <div className="page-head">
        <div>
          <h1>楼层列表</h1>
          <p>楼层数据来自新增时上传的 GeoJSON，商铺在楼层详情中维护。</p>
        </div>
        <Button type="primary" onClick={() => history.push('/floors/new')}>
          新增楼层
        </Button>
      </div>

      <Card>
        <Table
          rowKey="id"
          columns={columns}
          dataSource={floors}
          loading={loading}
          pagination={false}
          locale={{
            emptyText: (
              <Empty
                image={Empty.PRESENTED_IMAGE_SIMPLE}
                description="暂无楼层，点击右上角「新增楼层」"
              />
            ),
          }}
        />
      </Card>
    </div>
  );
}
