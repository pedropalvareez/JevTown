import { defineConfig } from 'vite';

const proxy = {
  '/api': {
    target: process.env.API_PROXY_TARGET ?? 'http://127.0.0.1:4000',
    changeOrigin: true,
    ws: true,
    rewrite: (path: string) => path.replace(/^\/api/, ''),
  },
};

export default defineConfig({
  server: { port: 5173, strictPort: true, proxy },
  preview: { port: 5173, strictPort: true, proxy },
});
