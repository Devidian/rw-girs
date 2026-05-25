# syntax=docker/dockerfile:1

FROM node:24-alpine AS deps
WORKDIR /app

ENV YARN_NODE_LINKER=node-modules

COPY package.json yarn.lock .yarnrc.yml ./
COPY .yarn/releases ./.yarn/releases

RUN corepack enable && yarn install --immutable

FROM deps AS build
WORKDIR /app

COPY tsconfig.json tsconfig.build.json ./
COPY src ./src

RUN yarn build

FROM node:24-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    GIRS_HOST=0.0.0.0 \
    GIRS_PORT=47015

COPY --from=deps /app/package.json ./package.json
COPY --from=deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist

EXPOSE 47015

CMD ["node", "dist/main.js"]
