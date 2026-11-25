# syntax=docker/dockerfile:1
FROM node:22-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

FROM node:22-alpine AS ui-build
WORKDIR /app
COPY package.json package-lock.json vite.config.mjs ./
RUN npm ci --include=dev
COPY ui ./ui
RUN npm run build

FROM node:22-alpine
ARG APP_VERSION=dev
ENV NODE_ENV=production PORT=8787 DATA_DIR=/data APP_VERSION=$APP_VERSION
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY package.json ./
COPY src ./src
COPY --from=ui-build /app/dist/ui ./dist/ui
RUN mkdir -p /data && chown node:node /data
USER node
VOLUME /data
EXPOSE 8787
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s \
  CMD node -e "fetch('http://127.0.0.1:8787/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "src/server.mjs"]
