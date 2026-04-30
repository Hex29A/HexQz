# Stage 1: build React client
FROM node:20-alpine AS client-builder
WORKDIR /app/client
COPY client/package.json ./
RUN npm install
COPY client/ ./
RUN npm run build

# Stage 2: run server + serve built client
FROM node:20-alpine
WORKDIR /app
COPY server/package.json ./
RUN npm install --omit=dev
COPY server/ ./
COPY --from=client-builder /app/client/dist ./public
RUN mkdir -p /app/data /app/uploads
EXPOSE 3042
CMD ["node", "index.js"]
