# syntax=docker/dockerfile:1.7

FROM node:22.22.1-alpine3.23@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00 AS base

ENV PNPM_HOME=/pnpm
ENV PATH=/pnpm:$PATH
RUN corepack enable
WORKDIR /app

FROM base AS dependencies

COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/server/package.json packages/server/tsconfig.json packages/server/tsconfig.type-tests.json ./packages/server/
COPY packages/facilitator/package.json packages/facilitator/tsconfig.json ./packages/facilitator/
COPY web/package.json web/tsconfig.json web/next-env.d.ts web/next.config.ts ./web/
RUN --mount=type=cache,id=agentpay-pnpm,target=/pnpm/store \
    pnpm install --frozen-lockfile

FROM dependencies AS builder

ARG AGENTPAY_RELEASE=local
ARG NEXT_PUBLIC_SITE_URL=https://agentpay.thebestsites.ru/
ENV AGENTPAY_RELEASE=$AGENTPAY_RELEASE
ENV NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL
ENV NEXT_TELEMETRY_DISABLED=1

COPY packages ./packages
COPY web ./web
RUN pnpm --filter @agentpay/server --filter @agentpay/facilitator run build
RUN pnpm --dir web build
RUN pnpm --dir web build:migrate
RUN pnpm --filter @agentpay/facilitator --prod deploy --legacy /output/facilitator

FROM node:22.22.1-alpine3.23@sha256:8094c002d08262dba12645a3b4a15cd6cd627d30bc782f53229a2ec13ee22a00 AS runner

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
WORKDIR /app

COPY --from=builder --chown=node:node /app/web/.next/standalone ./
COPY --from=builder --chown=node:node /app/web/.next/static ./web/.next/static
COPY --from=builder --chown=node:node /app/web/scripts/migrate.mjs ./web/scripts/migrate.mjs
COPY --from=builder --chown=node:node /app/web/src/db/migrations ./web/src/db/migrations
COPY --from=builder --chown=node:node /output/facilitator ./facilitator

USER node
EXPOSE 3000 4022
CMD ["node", "/app/web/server.js"]
