FROM node:22-alpine AS base
RUN corepack enable && corepack prepare pnpm@latest --activate
WORKDIR /app

FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml package.json tsconfig.base.json ./
COPY packages/core/package.json packages/core/
COPY packages/web/package.json packages/web/
COPY packages/api/package.json packages/api/
COPY packages/cli/package.json packages/cli/
COPY packages/mcp-server/package.json packages/mcp-server/
COPY packages/supervisor/package.json packages/supervisor/
COPY packages/tooling-mcp/package.json packages/tooling-mcp/
RUN pnpm install --frozen-lockfile

FROM base AS build
COPY --from=deps /app/node_modules ./node_modules
COPY --from=deps /app/packages/ ./packages/
COPY . .
RUN pnpm build
RUN cd packages/web && pnpm next build

FROM base AS web
COPY --from=build /app/packages/web/.next/standalone ./
COPY --from=build /app/packages/web/.next/static ./packages/web/.next/static
EXPOSE 3100
CMD ["node", "packages/web/server.js"]

FROM base AS api
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/packages/core ./packages/core
COPY --from=build /app/packages/api ./packages/api
COPY --from=build /app/package.json ./
EXPOSE 3200
CMD ["node", "packages/api/dist/index.js"]
