# Multi-stage production image for Argus (Next.js + Prisma + Transformers.js).
FROM node:24-bookworm-slim AS deps
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM node:24-bookworm-slim AS builder
WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Prisma client for build
RUN pnpm db:generate
ENV NEXT_TELEMETRY_DISABLED=1
# Dummy env so Next can evaluate modules at build time
ENV DATABASE_URL=postgresql://argus:argus@localhost:5432/argus \
    ELASTICSEARCH_URL=http://localhost:9200 \
    SESSION_SECRET=build-time-session-secret-32 \
    DEMO_CYCLE_DATE=2026-10-28 \
    DEMO_AUTH=true \
    DEMO_MODE=true
RUN pnpm build

# Pre-warm embedding model into image layer (Phase 3 uses it; optional failure OK)
RUN node -e "\
  (async () => {\
    try {\
      const { pipeline } = await import('@huggingface/transformers');\
      const extractor = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');\
      await extractor('argus warm', { pooling: 'mean', normalize: true });\
      console.log('embedding model warmed');\
    } catch (e) {\
      console.warn('embedding warm skipped', e);\
    }\
  })();\
" || true

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0
RUN corepack enable && corepack prepare pnpm@10.26.2 --activate \
  && apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates \
  && rm -rf /var/lib/apt/lists/*
COPY --from=builder /app/package.json /app/pnpm-lock.yaml ./
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/prisma ./prisma
COPY --from=builder /app/policy.v1.json ./policy.v1.json
COPY --from=builder /app/data ./data
COPY --from=builder /app/scripts ./scripts
# Transformers.js cache if warm succeeded
COPY --from=builder /root/.cache /root/.cache

EXPOSE 3000
CMD ["pnpm", "start"]
