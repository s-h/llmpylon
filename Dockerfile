FROM node:20-slim AS build

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*

RUN npm i -g npm@11.6.2

ENV npm_config_build_from_source=sqlite3

COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY client/package.json client/package-lock.json ./client/
RUN cd client && npm ci

COPY client ./client
RUN cd client && npm run build

FROM node:20-slim

WORKDIR /app

ENV NODE_ENV=production
ENV PORT=3000
ENV DB_PATH=/data/database.sqlite

COPY --from=build /app/node_modules ./node_modules
COPY package.json package-lock.json ./

COPY server ./server
COPY docker ./docker
COPY --from=build /app/client/dist ./client/dist

VOLUME ["/data"]
EXPOSE 3000

CMD ["node", "server/docker-entrypoint.js"]
