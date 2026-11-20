import { Button, Drawer, Form, Input, Space, Typography } from "antd";
import React from "react";

const FloorMerchantUpdate = ({
  shops,
  editing,
  onSuccess,
  onCancel,
  ...rest
}) => {
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

  return (
    <Drawer
      title="编辑铺位信息"
      placement="right"
      width={360}
      {...rest}
      destroyOnClose
    >
      {editing && (
        <Form
          // form={editForm}
          key={editing.uid}
          layout="vertical"
          initialValues={{
            code: editing.code,
            merchantNo: editing.merchantNo,
            merchantName: editing.merchantName,
          }}
          onFinish={onSuccess}
        >
          <Typography.Paragraph type="secondary">
            当前铺位 {editing.label}
          </Typography.Paragraph>
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
            label="商户号"
          >
            <Input placeholder="选填" />
          </Form.Item>
          <Form.Item
            name="merchantName"
            label="商户名称"
          >
            <Input placeholder="选填" />
          </Form.Item>
          <Space>
            <Button
              type="primary"
              htmlType="submit"
            >
              保存
            </Button>
            <Button
              htmlType="button"
              onClick={onCancel}
            >
              取消
            </Button>
          </Space>
        </Form>
      )}
    </Drawer>
  );
};

export default FloorMerchantUpdate;
