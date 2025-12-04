# Hive Server Dockerfile
# Multi-stage build for smaller production image

# =============================================================================
# Build stage
# =============================================================================
FROM node:20-alpine AS builder

WORKDIR /app

# Copy package files
COPY package*.json ./

# Install all dependencies (including devDependencies for build)
RUN npm i

# Copy source code
COPY tsconfig.json ./
COPY src ./src

# Build TypeScript
RUN npm run build

# =============================================================================
# Production stage
# =============================================================================
FROM node:20-alpine AS production

WORKDIR /app

# Create non-root user for security
RUN addgroup -g 1001 -S hive && \
    adduser -S -D -H -u 1001 -G hive hive

# Copy package files
COPY package*.json ./

# Install production dependencies only
RUN npm i --only=production && \
    npm cache clean --force

# Copy built files from builder stage
COPY --from=builder /app/dist ./dist

# Create data directories
RUN mkdir -p /app/data/vaults /app/data/backups && \
    chown -R hive:hive /app/data

# Switch to non-root user
USER hive

# Environment variables with defaults
ENV NODE_ENV=production \
    PORT=3000 \
    DATABASE_PATH=/app/data/users.db \
    VAULTS_PATH=/app/data/vaults \
    BACKUPS_PATH=/app/data/backups

# Expose port
EXPOSE 3000

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/api/health || exit 1

# Start server
CMD ["node", "dist/index.js"]

