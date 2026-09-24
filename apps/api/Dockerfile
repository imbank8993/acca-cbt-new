# ─── Tahap 1: Kompilasi & Build ────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

# Salin package.json untuk instalasi dependensi
COPY package*.json ./
COPY packages/shared/package*.json ./packages/shared/
COPY apps/api/package*.json ./apps/api/

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
FROM node:20-alpine AS runner

WORKDIR /app
RUN apk add --no-cache openssl libc6-compat

ENV NODE_ENV=production \
    PORT=3009 \
    HOST=0.0.0.0

# Jalankan dengan non-root user demi keamanan
RUN addgroup --system --gid 1001 nodejs && \
    adduser --system --uid 1001 nestjs

COPY --chown=nestjs:nodejs package*.json ./
COPY --chown=nestjs:nodejs --from=builder /app/node_modules ./node_modules
COPY --chown=nestjs:nodejs --from=builder /app/packages/shared ./packages/shared
COPY --chown=nestjs:nodejs --from=builder /app/apps/api/package.json ./apps/api/
COPY --chown=nestjs:nodejs --from=builder /app/apps/api/prisma ./apps/api/prisma
COPY --chown=nestjs:nodejs --from=builder /app/apps/api/dist ./apps/api/dist

USER nestjs

EXPOSE 3009

HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD wget --no-verbose --tries=1 --spider http://127.0.0.1:3009/api/health || exit 1

CMD ["node", "apps/api/dist/main.js"]
