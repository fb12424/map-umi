const apiTarget = process.env.API_TARGET || 'http://localhost:3000';
const apiBase = process.env.API_BASE || '/api';

module.exports = {
  nodeModulesTransform: { type: 'none' },
  extraBabelIncludes: ['polyclip-ts', 'splaytree-ts'],
  history: { type: 'hash' },
  publicPath: './',
  hash: true,
  define: {
    'process.env.API_BASE': apiBase,
  },
  proxy: {
    '/api': {
      target: apiTarget,
      changeOrigin: true,
    },
  },
  devServer: {
    host: '0.0.0.0',
    port: 5174,
  },
  routes: [
    {
      path: '/',
      component: '@/layouts/index',
      routes: [
        { path: '/', redirect: '/floors' },
        { path: '/floors', component: '@/pages/FloorList' },
        { path: '/overview', component: '@/pages/FloorOverview' },
        { path: '/floors/new', component: '@/pages/FloorCreate' },
        { path: '/floors/:floorId/edit', component: '@/pages/FloorCreate' },
        { path: '/floors/:floorId/preview', component: '@/pages/FloorPreview' },
        { path: '*', redirect: '/floors' },
      ],
    },
  ],
};