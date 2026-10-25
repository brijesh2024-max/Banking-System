FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --ignore-scripts --no-fund --no-audit
COPY client ./client
RUN npm run build

FROM node:22-bookworm-slim AS runtime
WORKDIR /app
ENV NODE_ENV=production HOST=0.0.0.0 PORT=4000 SANDBOX_FUNDING=false
COPY package.json package-lock.json ./
COPY client/package.json ./client/package.json
COPY server/package.json ./server/package.json
RUN npm ci --omit=dev --ignore-scripts --no-fund --no-audit && npm cache clean --force
COPY --chown=node:node server/src ./server/src
COPY --from=build --chown=node:node /app/client/dist ./client/dist
USER node
EXPOSE 4000
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s CMD node -e "fetch('http://127.0.0.1:4000/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["node", "server/src/index.js"]
