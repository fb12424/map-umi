import { Layout, Menu } from 'antd';
import { history, useLocation } from 'umi';
import styles from '../styles/layout.less';

const { Header, Content } = Layout;

const MENU_ITEMS = [{ key: '/floors', label: '楼层管理' }];

export default function BasicLayout({ children }) {
  const { pathname } = useLocation();
  const selectedKey = pathname.startsWith('/floors') ? '/floors' : '';

  return (
    <Layout className={styles.appShell}>
      <Header className={styles.appHeader}>
        <div className={styles.appBrand}>
          地图管理后台DEMO
        </div>
        <Menu
          className={styles.appMenu}
          mode="horizontal"
          selectedKeys={[selectedKey]}
          items={MENU_ITEMS}
          onClick={({ key }) => history.push(key)}
        />
      </Header>
      <Content className={styles.appContent}>{children}</Content>
    </Layout>
  );
}