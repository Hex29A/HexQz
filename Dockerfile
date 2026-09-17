# Stage 1: build React client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package.json client/package-lock.json ./
RUN npm ci
COPY client/ ./
RUN npm run build

# Stage 2: run server + serve built client
FROM node:20-alpine
ARG BUILD_HASH=dev
ENV BUILD_HASH=$BUILD_HASH
WORKDIR /app
COPY server/package.json server/package-lock.json ./
RUN npm ci --omit=dev
COPY server/ ./
COPY --from=client-builder /app/client/dist ./public
RUN mkdir -p /app/data /app/uploads
EXPOSE 3042
CMD ["node", "index.js"]
