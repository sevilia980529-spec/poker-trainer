# 牌技 AI 训练场 — 一体化部署镜像
FROM node:20-alpine AS build
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY . .
RUN npm run build && npm run build:server

FROM node:20-alpine
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/dist ./dist
COPY --from=build /app/dist-server ./dist-server
COPY --from=build /app/node_modules/ws ./node_modules/ws
COPY package.json ./
EXPOSE 7100
ENV PORT=7100
CMD ["node", "dist-server/server.mjs"]
