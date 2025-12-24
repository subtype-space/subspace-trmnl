FROM node:22.10 AS base

USER node
WORKDIR /opt/api
RUN mkdir subspace-db
RUN chown -R node:node /opt/api

RUN npm install typescript
COPY --chown=node:node package.json .
COPY --chown=node:node package-lock.json .
COPY --chown=node:node tsconfig.json .

FROM base AS builder
LABEL stage=build
USER node
WORKDIR /opt/api
COPY --chown=node:node ./src /opt/api/src
RUN npm install
RUN npm run build

FROM base AS production
USER node
WORKDIR /opt/api
COPY --chown=node:node --from=builder /opt/api/node_modules ./node_modules
COPY --chown=node:node --from=builder /opt/api/build ./build

ENTRYPOINT [ "npm", "run", "start" ]