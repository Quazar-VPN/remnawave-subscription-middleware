import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// SPA живёт под /admin/app/ (strangler-fig рядом с легаси-админкой на /admin/).
// base влияет на пути ассетов в собранном index.html; nginx отдаёт /admin/app/*
// статикой и делает history-fallback на /admin/app/index.html.
export default defineConfig({
  base: '/admin/app/',
  plugins: [react()],
  build: {
    // Собираем в admin/app (не в admin/spa/dist), чтобы Docker-стадия копировала
    // готовые ассеты одним слоем прямо в корень раздачи.
    outDir: '../app',
    emptyOutDir: true,
  },
  server: {
    // Локальная разработка: проксируем API на запущенный контейнер/php.
    proxy: {
      '/admin/api.php': 'http://127.0.0.1:8080',
    },
  },
});
