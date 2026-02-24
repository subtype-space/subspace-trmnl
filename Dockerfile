FROM node:22.22 AS base

USER node
WORKDIR /opt/api
RUN mkdir subspace-db
RUN chown -R node:node /opt/api

COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
COPY --chown=node:node tsconfig.json .

FROM base AS builder
LABEL stage=build
USER node
WORKDIR /opt/api
COPY --chown=node:node ./src /opt/api/src
RUN npm ci
RUN npm run build

FROM base AS production
USER node
WORKDIR /opt/api
RUN npm ci --omit=dev
COPY --chown=node:node --from=builder /opt/api/build ./build
ENTRYPOINT [ "npm", "run", "start" ]
