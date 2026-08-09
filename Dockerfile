# syntax=docker/dockerfile:1

# ============================================================
#  AŞAMA 1 — Bağımlılıklar + Build (builder)
# ============================================================
FROM node:20-slim AS builder
WORKDIR /app

# Sadece manifest'leri kopyalayıp bağımlılıkları kur (katman önbelleği)
COPY package.json package-lock.json ./
RUN npm ci

# NEXT_PUBLIC_* değişkenleri Next.js'te BUILD ZAMANINDA tarayıcı koduna gömülür
# (runtime env'den OKUNMAZ). Bu yüzden docker-compose'daki `build.args` ile buraya
# geçirilmesi ZORUNLU — yoksa Turnstile/tenant gibi client tarafı boş kalır.
ARG NEXT_PUBLIC_TURNSTILE_SITE_KEY
ENV NEXT_PUBLIC_TURNSTILE_SITE_KEY=${NEXT_PUBLIC_TURNSTILE_SITE_KEY}

# Kaynak kodu kopyala ve üretim build'i al (standalone çıktı üretir)
COPY . .
ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ============================================================
#  AŞAMA 2 — Çalışma imajı (runner) — minimal, standalone
# ============================================================
FROM node:20-slim AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Root olmayan kullanıcı (güvenlik)
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs

# Standalone çıktı: server.js + gerekli (trace edilmiş) node_modules
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
# DİKKAT: public ve .next/static standalone'a OTOMATİK kopyalanmaz — elle eklenir
COPY --from=builder --chown=nextjs:nodejs /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

USER nextjs
EXPOSE 3000

CMD ["node", "server.js"]
