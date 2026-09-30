FROM node:20.20.0-bookworm-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/web/package.json ./apps/web/package.json
COPY apps/api/package.json ./apps/api/package.json
RUN npm ci
COPY tsconfig.base.json ./
COPY apps ./apps
RUN npm run typecheck && npm run test && npm run build

FROM base AS api
EXPOSE 4000
USER node
CMD ["node", "apps/api/dist/server.js"]

FROM base AS web
EXPOSE 5173
RUN chown node:node /app/node_modules/.vite-temp
USER node
CMD ["npm", "run", "preview", "--workspace", "@jev-town/web"]
