# ─── Tahap 1: Kompilasi & Build Next.js ───────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
RUN apk add --no-cache libc6-compat

# Salin package.json untuk instalasi dependensi
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/web/package*.json ./apps/web/

RUN npm ci

# Kompilasi paket shared terlebih dahulu
COPY packages/shared ./packages/shared
RUN npm run build:shared

# Salin kode sumber frontend Next.js
COPY apps/web ./apps/web

ENV NEXT_TELEMETRY_DISABLED=1 \
    NODE_ENV=production

# Bangun aplikasi Next.js (output standalone otomatis terbentuk di apps/web/.next/standalone)
RUN npm run build --workspace=apps/web

# ─── Tahap 2: Runtime Produksi (Standalone Minimal) ───────────────────────────
FROM node:20-alpine AS runner

WORKDIR /app
RUN apk add --no-cache libc6-compat

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3008 \
    HOSTNAME="0.0.0.0"

# Jalankan dengan non-root user demi keamanan
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nextjs

# Salin berkas statis publik
COPY --from=builder /app/apps/web/public ./apps/web/public

# Salin hasil kompilasi standalone dan static chunks Next.js
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/apps/web/.next/static ./apps/web/.next/static

USER nextjs

EXPOSE 3008

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3008/ || exit 1

CMD ["node", "apps/web/server.js"]
