FROM node:20-alpine AS deps
WORKDIR /app
# Copy lock file first — Docker layer cache means npm ci only reruns when deps change
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

# ── Runtime image ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS runtime
WORKDIR /app

# Copy pre-installed node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY src ./src
COPY package.json ./

# Non-root user for security
RUN addgroup -S appgroup && adduser -S appuser -G appgroup
USER appuser

EXPOSE 3001

# Use exec form so SIGTERM reaches node directly (not via shell)
CMD ["node", "src/index.js"]
