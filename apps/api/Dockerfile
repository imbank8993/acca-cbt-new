# ─── Tahap 1: Kompilasi & Build ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS builder

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates && rm -rf /var/lib/apt/lists/*

# Salin semua berkas package.json monorepo untuk instalasi dependensi yang lengkap
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

# Kompilasi paket shared terlebih dahulu
COPY packages/shared ./packages/shared
RUN npm run build:shared

# Siapkan Prisma Client dan kompilasi NestJS
COPY apps/api ./apps/api
RUN npx prisma generate --schema=apps/api/prisma/schema.prisma
RUN npm run build --workspace=apps/api

# Buang devDependencies untuk merampingkan ukuran akhir
RUN npm prune --omit=dev

# ─── Tahap 2: Runtime Produksi ────────────────────────────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends openssl ca-certificates curl && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    PORT=3009 \
    HOST=0.0.0.0

# Jalankan dengan non-root user demi keamanan (Debian system user)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nestjs

COPY --chown=nestjs:nodejs package*.json ./
COPY --chown=nestjs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs --from=builder /app/packages/shared ./packages/shared
COPY --chown=nestjs:nodejs --from=builder /app/apps/api/package.json ./apps/api/
COPY --chown=nestjs:nodejs --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --chown=nestjs:nodejs --from=builder /app/apps/api/dist ./apps/api/dist

USER nestjs

EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f http://127.0.0.1:3009/api/health || exit 1

# Runner command tahan banting dengan fallback struktur kompilasi monorepo NestJS
CMD ["sh", "-c", "node apps/api/dist/src/main.js 2>/dev/null || node apps/api/dist/main.js 2>/dev/null || node dist/src/main.js 2>/dev/null || node dist/main.js"]

