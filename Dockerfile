# syntax=docker/dockerfile:1
ARG NODE_VERSION=24-alpine

# ---------- base ----------
FROM node:${NODE_VERSION} AS base
WORKDIR /app
RUN apk add --no-cache dumb-init

# ---------- deps (كل الاعتماديات، تُستخدم للتطوير والبناء) ----------
FROM base AS deps
COPY package.json package-lock.json ./
COPY prisma ./prisma
RUN npm ci && npx prisma generate

# ---------- prod-deps (اعتماديات الإنتاج فقط، بدون postinstall scripts) ----------
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

# ---------- build ----------
FROM deps AS build
COPY . .
RUN npx prisma generate && npm run build

# ---------- development (hot-reload عبر docker-compose بالتطوير) ----------
FROM deps AS development
ENV NODE_ENV=development
COPY . .
RUN chown -R node:node /app
USER node
EXPOSE 3000
ENTRYPOINT ["dumb-init", "--"]
CMD ["npm", "run", "start:dev"]

# ---------- production ----------
FROM base AS production
ENV NODE_ENV=production
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=build /app/dist ./dist
COPY --from=build /app/prisma ./prisma
COPY --from=build /app/package.json ./package.json
RUN chown -R node:node /app
USER node
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:3000/health/live',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
ENTRYPOINT ["dumb-init", "--"]
CMD ["node", "dist/main.js"]
