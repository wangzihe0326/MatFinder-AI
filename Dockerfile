FROM node:20-bookworm-slim

WORKDIR /app

ENV NODE_ENV=production \
    PORT=3000 \
    MATFINDER_DB_PATH=/app/matfinder.db

RUN apt-get update \
  && apt-get install -y --no-install-recommends python3 ca-certificates \
  && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm install --omit=dev

COPY . .
RUN npm run migrate:materials

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:' + (process.env.PORT || 3000) + '/api/health').then((r) => process.exit(r.ok ? 0 : 1)).catch(() => process.exit(1))"

CMD ["node", "server.js"]
