# The API, serving the built web app on the same origin. Mount the converted BD ALTI tiles
# at BDALTI_DIR and point BROUTER_URL at the BRouter server. To name routes after their
# commune, mount the file written by scripts/convert-admin-express.ts and set COMMUNES_FILE.

FROM node:26-slim AS base
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
RUN pnpm build

FROM base
RUN pnpm install --frozen-lockfile --prod --filter @path-finder/api
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
ENV NODE_ENV=production BDALTI_DIR=/data/bdalti BROUTER_URL=http://brouter:17777
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/index.ts"]
