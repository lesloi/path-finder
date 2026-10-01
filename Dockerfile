# The API, serving the built web app on the same origin. Point BROUTER_URL at the BRouter
# server. To count elevation gain, mount the converted BD ALTI tiles and set BDALTI_DIR.

FROM node:26-slim AS base
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/

FROM base AS build
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
# The web app imports the route generation's bounds and criteria checks through the API's contract.
COPY apps/api/src/contract.ts apps/api/src/contract.ts
COPY apps/api/src/route-generation apps/api/src/route-generation
RUN pnpm build

FROM base
RUN pnpm install --frozen-lockfile --prod --filter @path-finder/api
COPY apps/api/src apps/api/src
COPY --from=build /app/apps/web/dist apps/web/dist
ENV NODE_ENV=production
USER node
EXPOSE 3000
CMD ["node", "apps/api/src/main.ts"]
