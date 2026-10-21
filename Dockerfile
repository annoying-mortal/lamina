FROM node:24.11.1-alpine3.22 AS node-base
WORKDIR /app

FROM node-base AS build
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

COPY . .
ARG SITE_URL=http://localhost:8080
ENV SITE_URL=${SITE_URL}
# Images always start from the distributable examples. Live content is mounted
# separately, so a developer's local articles never become a new site's defaults.
RUN mkdir -p src/content && node scripts/initialize-content.mjs && npm run check && npm run build && npm run verify

FROM build AS production-dependencies
RUN npm prune --omit=dev --no-audit --no-fund

FROM node-base AS admin
COPY --from=production-dependencies /app /app
ARG ADMIN_UID=1000
ARG ADMIN_GID=1000
ARG SITE_URL=http://localhost:8080
ENV SITE_URL=${SITE_URL}
ENV ADMIN_HOST=0.0.0.0 ADMIN_PORT=4322 ADMIN_AUTO_PUBLISH=1 ADMIN_AUTH_DIR=/app/.admin SITE_PUBLISH_ROOT=/published SITE_UPLOADS_DIR=/app/public/uploads ASTRO_TELEMETRY_DISABLED=1
RUN mkdir -p /published/releases /app/public/uploads /app/.admin && chmod 700 /app/.admin && cp -R /app/dist /published/releases/initial && ln -s releases/initial /published/current && chown -R ${ADMIN_UID}:${ADMIN_GID} /app /published
USER ${ADMIN_UID}:${ADMIN_GID}
EXPOSE 4322
HEALTHCHECK --interval=15s --timeout=4s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:4322/healthz').then(r=>{if(!r.ok)process.exit(1)}).catch(()=>process.exit(1))"
CMD ["sh", "scripts/start-admin.sh"]

FROM nginx:1.28.3-alpine AS runtime
COPY nginx/nginx.conf /etc/nginx/nginx.conf
COPY --from=build /app/dist /usr/share/nginx/html/releases/initial
COPY --from=build /app/public/uploads /var/www/uploads
COPY --from=build /app/public/fonts/alimama-fangyuan /var/www/site-fonts/alimama-fangyuan
RUN ln -s releases/initial /usr/share/nginx/html/current && chown -R 1000:1000 /usr/share/nginx/html /var/www/uploads
COPY README.md /usr/share/doc/personal-blog/README.md

# All runtime writes go to /tmp; the web server never needs root privileges.
USER nginx
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["nginx"]
CMD ["-g", "daemon off;"]
