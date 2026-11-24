import { ConfigProvider } from 'antd';
import zhCN from 'antd/es/locale/zh_CN';
import 'antd/dist/antd.css';
import './styles/global.less';

export function rootContainer(container) {
  return <ConfigProvider locale={zhCN}>{container}</ConfigProvider>;
}