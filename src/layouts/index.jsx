import { Layout, Menu } from 'antd';
import { history, useLocation } from 'umi';

const { Header, Content } = Layout;

const MENU_ITEMS = [{ key: '/floors', label: '楼层管理' }];

export default function BasicLayout({ children }) {
  const { pathname } = useLocation();
  const selectedKey = pathname.startsWith('/floors') ? '/floors' : '';

  return (
    <Layout className="app-shell">
      <Header className="app-header">
        <div className="app-brand">
          地图管理后台DEMO
        </div>
        <Menu
          className="app-menu"
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => history.push(key)}
        />
      </Header>
      <Content className="app-content">{children}</Content>
    </Layout>
  );
}