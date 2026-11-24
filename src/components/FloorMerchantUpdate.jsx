import {
  Button,
  Drawer,
  Form,
  Input,
  Select,
  Space,
  Typography,
  message,
} from "antd";
import React, { useEffect, useMemo, useState } from "react";
import { listMerchants } from "../services/merchants.js";
import { AREA_TYPE, AREA_TYPE_LABEL } from "../lib/shopGeometry.js";
import AreaTypeSelect from "./AreaTypeSelect/index.jsx";
import {
  ElevatorIcon,
  NursingIcon,
  ObstacleIcon,
  ShopIcon,
  ToiletIcon,
} from "./AreaTypeSelect/icons.jsx";

const AREA_TYPE_OPTIONS = [
  { value: AREA_TYPE.SHOP, label: AREA_TYPE_LABEL[AREA_TYPE.SHOP], icon: <ShopIcon /> },
  {
    value: AREA_TYPE.ELEVATOR,
    label: AREA_TYPE_LABEL[AREA_TYPE.ELEVATOR],
    icon: <ElevatorIcon />,
  },
  { value: AREA_TYPE.TOILET, label: AREA_TYPE_LABEL[AREA_TYPE.TOILET], icon: <ToiletIcon /> },
  { value: AREA_TYPE.NURSING, label: AREA_TYPE_LABEL[AREA_TYPE.NURSING], icon: <NursingIcon /> },
  {
    value: AREA_TYPE.OBSTACLE,
    label: AREA_TYPE_LABEL[AREA_TYPE.OBSTACLE],
    icon: <ObstacleIcon />,
  },
];

const TOILET_TYPE_OPTIONS = [
  { value: "male", label: "男厕" },
  { value: "female", label: "女厕" },
  { value: "both", label: "男/女厕" },
];

const FloorMerchantUpdate = ({
  shops,
  editing,
  open,
  onSuccess,
  onCancel,
  ...rest
}) => {
  const [form] = Form.useForm();
  const [merchants, setMerchants] = useState([]);
  const [loadingMerchants, setLoadingMerchants] = useState(false);

  useEffect(() => {
    if (open && editing) {
      form.setFieldsValue({
        type: editing.type || AREA_TYPE.SHOP,
        code: editing.code,
        merchantNo: editing.merchantNo,
        merchantName: editing.merchantName,
        name: editing.name,
        areaNo: editing.areaNo,
        toiletType: editing.toiletType,
      });
    }
  }, [open, editing]);

  const validateShopCode = (_, value) => {
    const next = (value || "").trim();
    if (!next) return Promise.resolve();

    const taken = shops?.features.some(
      (feature) =>
        feature.properties.uid !== editing?.uid &&
        (feature.properties.code || "").trim() === next,
    );

    return taken
      ? Promise.reject(new Error("该铺位号已被其他铺位占用"))
      : Promise.resolve();
  };

  useEffect(() => {
    if (!open || merchants.length) return undefined;

    let alive = true;
    setLoadingMerchants(true);
    listMerchants()
      .then((data) => {
        if (alive) setMerchants(Array.isArray(data) ? data : []);
      })
      .catch((error) => {
        if (alive) message.error(error.message || "商户列表加载失败");
      })
      .finally(() => {
        if (alive) setLoadingMerchants(false);
      });

    return () => {
      alive = false;
    };
  }, [open, merchants.length]);

  const merchantOptions = useMemo(
    () =>
      merchants.map((merchant) => ({
        value: merchant.departmentCode,
        label: `${merchant.brandName}（${merchant.departmentCode}）`,
      })),
    [merchants],
  );

  const handleMerchantChange = (value) => {
    const merchant = merchants.find((item) => item.departmentCode === value);
    form.setFieldsValue({ merchantName: merchant?.brandName || "" });
  };

  // 区域类型联动表单：商铺走位号/商户，障碍区无字段，其余设施走名称/区域号
  const type = Form.useWatch("type", form) || AREA_TYPE.SHOP;
  const isShop = type === AREA_TYPE.SHOP;
  const isObstacle = type === AREA_TYPE.OBSTACLE;
  const drawerTitle = isShop
    ? "编辑铺位信息"
    : isObstacle
    ? "编辑障碍区信息"
    : "编辑区域信息";
  const currentText = editing
    ? editing.label || AREA_TYPE_LABEL[type] || ""
    : "";

  return (
    <Drawer
      title={drawerTitle}
      placement="right"
      width={380}
      open={open}
      {...rest}
      destroyOnClose
    >
      {editing && (
        <Form
          form={form}
          key={editing.uid}
          layout="vertical"
          onFinish={onSuccess}
        >
          <Typography.Paragraph type="secondary">
            当前{isShop ? "铺位" : "区域"} {currentText}
          </Typography.Paragraph>
          <Form.Item
            name="type"
            label="区域类型"
            rules={[
              { required: true, whitespace: true, message: "请选择区域类型" },
            ]}
          >
            <AreaTypeSelect options={AREA_TYPE_OPTIONS} />
          </Form.Item>
          {isShop ? (
            <>
              <Form.Item
                name="code"
                label="铺位号"
                rules={[
                  { required: true, whitespace: true, message: "请输入铺位号" },
                  { validator: validateShopCode },
                ]}
              >
                <Input placeholder="如 1F-A01" />
              </Form.Item>
              <Form.Item
                name="merchantNo"
                label="商户"
                extra="选择后可自动带出商户号与商户名称"
              >
                <Select
                  allowClear
                  showSearch
                  loading={loadingMerchants}
                  placeholder="按商户名称或商户号搜索"
                  optionFilterProp="label"
                  options={merchantOptions}
                  onChange={handleMerchantChange}
                />
              </Form.Item>
              <Form.Item name="merchantName" hidden>
                <Input />
              </Form.Item>
            </>
          ) : isObstacle ? (
            <Typography.Paragraph type="secondary">
              障碍区用于表示墙体、柱子或镂空地板：不显示地图标签，不参与铺位导航，
              并会在路径规划中作为不可通行区域。
            </Typography.Paragraph>
          ) : (
            <>
              <Form.Item
                name="name"
                label="名称"
                rules={[
                  { required: true, whitespace: true, message: "请输入名称" },
                ]}
              >
                <Input placeholder="如 公共卫生间、1 号客梯" />
              </Form.Item>
              {type === "toilet" && (
                <Form.Item
                  name="toiletType"
                  label="厕所类型"
                  rules={[{ required: true, message: "请选择厕所类型" }]}
                >
                  <Select options={TOILET_TYPE_OPTIONS} placeholder="请选择" />
                </Form.Item>
              )}
              {/* <Form.Item
                name="areaNo"
                label="编号"
                rules={[{ required: true, message: "请输入编号" }]}
              >
                <Input placeholder="选填" />
              </Form.Item> */}
            </>
          )}
          <Space>
            <Button type="primary" htmlType="submit">
              保存
            </Button>
            <Button htmlType="button" onClick={onCancel}>
              取消
            </Button>
          </Space>
        </Form>
      )}
    </Drawer>
  );
};

export default FloorMerchantUpdate;
