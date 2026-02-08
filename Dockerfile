FROM node:22.10 AS base

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

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://localhost:9595/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

ENTRYPOINT [ "npm", "run", "start" ]
