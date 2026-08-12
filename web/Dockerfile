# syntax=docker/dockerfile:1

# Builds the AgentPay Next.js site (web/) from the pnpm monorepo root.
# The app links the local @agentpay/client and @agentpay/server workspace packages,
# so the entire repository is the build context (see docker-compose.yml).

FROM node:22-alpine AS base
RUN corepack enable
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
WORKDIR /app

FROM base AS deps
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml tsconfig.json ./
COPY packages/ ./packages/
COPY web/package.json web/tsconfig.json web/next-env.d.ts web/next.config.ts ./web/
RUN pnpm install --frozen-lockfile

FROM deps AS builder
ENV NEXT_TELEMETRY_DISABLED=1
COPY web/ ./web/
COPY examples/ ./examples/
RUN pnpm --recursive --filter '@agentpay/server' --filter '@agentpay/client' run build
RUN pnpm --dir web build

FROM base AS runner
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
WORKDIR /app
COPY --from=builder /app/package.json /app/pnpm-workspace.yaml ./
COPY --from=builder /app/packages ./packages/
COPY --from=builder /app/node_modules ./node_modules/
COPY --from=builder /app/web ./web/
WORKDIR /app/web
EXPOSE 3000
CMD ["node", "node_modules/next/dist/bin/next", "start"]
