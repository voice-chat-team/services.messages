# Build stage
FROM node:22-alpine AS builder

WORKDIR /app

# Install dependencies
COPY package*.json ./
COPY prisma ./prisma/

RUN npm ci

# Copy source
COPY tsconfig*.json ./
COPY nest-cli.json ./
COPY src ./src/

# Build
RUN npx prisma generate
RUN npm run build

# Production stage
FROM node:22-alpine AS runtime

WORKDIR /app

# Copy built artifacts
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package*.json ./

# Copy Prisma schema and generated client
COPY --from=builder /app/prisma/schema.prisma ./prisma/
COPY --from=builder /app/prisma/migrations ./prisma/migrations/
COPY --from=builder /app/prisma/generated ./prisma/generated/
COPY prisma.config.ts ./

CMD ["sh", "-c", "npx prisma migrate deploy && node dist/src/main.js"]
