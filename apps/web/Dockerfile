# ─── Tahap 1: Kompilasi & Build Next.js ───────────────────────────────────────
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

# Salin kode sumber frontend Next.js
COPY apps/web ./apps/web

ARG NEXT_PUBLIC_ACCA_URL=https://acca.icgowa.sch.id
ARG NEXT_PUBLIC_SITE_URL=https://accav2-cbt.icgowa.sch.id


ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production \
    NEXT_PUBLIC_ACCA_URL=$NEXT_PUBLIC_ACCA_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL

# Bangun aplikasi Next.js (output standalone otomatis terbentuk di apps/web/.next/standalone)
RUN npm run build --workspace=apps/web


# ─── Tahap 2: Runtime Produksi (Standalone Minimal) ───────────────────────────
FROM node:20-bookworm-slim AS runner

WORKDIR /app
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3008 \
    HOSTNAME="0.0.0.0"

# Jalankan dengan non-root user demi keamanan (Debian system user)
RUN groupadd --system --gid 1001 nodejs && \
    useradd --system --uid 1001 --gid nodejs nextjs

# Salin berkas statis publik
COPY --from=builder /app/apps/web/public ./apps/web/public

# Salin hasil kompilasi standalone dan static chunks Next.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -f -L http://127.0.0.1:3008/ || exit 1

CMD ["sh", "-c", "node apps/web/server.js 2>/dev/null || node server.js"]

