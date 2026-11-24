# Backend for cloud deployment (Railway / Render / Fly.io / VPS + Docker)
FROM node:20-bookworm-slim

# sqlite3 needs build tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 make g++ && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install deps first for layer caching
COPY package*.json ./
RUN npm ci --omit=dev || npm install --omit=dev

# Copy sources and build
COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# Production deps already installed; ensure dev-only deps not required at runtime
ENV NODE_ENV=production
ENV DATA_DIR=/data
ENV HOST=0.0.0.0

# Persistent volume for the SQLite database
VOLUME ["/data"]

EXPOSE 3000
CMD ["node", "dist/index.js"]
