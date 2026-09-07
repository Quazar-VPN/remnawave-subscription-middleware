# --- Стадия 1: сборка React+Mantine SPA (новая админка, /admin/app/) ---------
# Vite собирает admin/spa → /app (outDir '../app'); готовые ассеты копируются в
# php-образ ниже одним слоем. Node в финальный образ не попадает.
FROM node:20-alpine AS spa
WORKDIR /spa
COPY admin/spa/package.json admin/spa/package-lock.json ./
RUN npm ci
COPY admin/spa/ ./
RUN npm run build

# --- Стадия 2: рантайм php-fpm + nginx ---------------------------------------
FROM php:8.3-fpm-bookworm
# sodium нужен защищённому каналу (протокол c1). В официальном образе он уже
# встроен, поэтому ниже он собирается только если его вдруг нет: вторая копия
# расширения дала бы «module already loaded» на каждом запросе.
ARG SUBMW_VERSION=dev
ENV SUBMW_DOCKER=1 SUBMW_VERSION=${SUBMW_VERSION}
RUN set -eux; \
    apt-get update; \
    apt-get install -y --no-install-recommends \
        nginx libcurl4-openssl-dev libsqlite3-dev libonig-dev libxml2-dev; \
    docker-php-ext-install -j"$(nproc)" pdo_sqlite pdo_mysql curl mbstring dom; \
    if ! php -m | grep -qi '^sodium$'; then \
        apt-get install -y --no-install-recommends libsodium-dev; \
        docker-php-ext-install -j"$(nproc)" sodium; \
    fi; \
    rm -rf /var/lib/apt/lists/*
COPY . /var/www/html
# Собранный SPA из стадии 1 (source admin/spa в образ не нужен — удаляется ниже).
COPY --from=spa /app /var/www/html/admin/app
COPY docker/nginx.conf /etc/nginx/conf.d/default.conf
COPY docker/entrypoint.sh /entrypoint.sh
RUN set -eux; \
    rm -rf /var/www/html/.git /var/www/html/.github /var/www/html/docker \
           /var/www/html/admin/spa \
           /var/www/html/install.sh /var/www/html/Dockerfile /var/www/html/.dockerignore; \
    rm -f /etc/nginx/sites-enabled/default; \
    sed -i 's/^listen = .*/listen = 127.0.0.1:9000/' /usr/local/etc/php-fpm.d/zz-docker.conf; \
    { echo 'pm = ondemand'; echo 'pm.max_children = 8'; echo 'pm.process_idle_timeout = 10s'; echo 'pm.max_requests = 500'; } >> /usr/local/etc/php-fpm.d/zz-docker.conf; \
    mkdir -p /var/www/html/data; \
    chown -R www-data:www-data /var/www/html; \
    chmod +x /entrypoint.sh
EXPOSE 80
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD php -r '$c=@fsockopen("127.0.0.1",9000,$e,$s,2); exit($c?0:1);' || exit 1
ENTRYPOINT ["/entrypoint.sh"]
