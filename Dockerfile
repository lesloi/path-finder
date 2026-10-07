# The server, serving the built web app on the same origin. It needs the graph and landmark files built
# ahead of serving: mount the directory that holds them (graph.bin, any.alt, paved.alt, unpaved.alt, or one such
# subdirectory per zone) on /data.

FROM node:26-slim AS web
RUN npm install --global pnpm@12.6.0
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile
COPY apps/web apps/web
# The web app reads the bounds and error codes of the server's contract.
COPY apps/server/contract apps/server/contract
RUN pnpm build

FROM golang:1.27 AS server
WORKDIR /src
COPY apps/server .
RUN CGO_ENABLED=0 go build -trimpath -o /server .

FROM gcr.io/distroless/static-debian12:nonroot
COPY --from=server /server /server
COPY --from=web /app/apps/web/dist /web
ENV WEB_ROOT=/web DATA_DIR=/data
VOLUME /data
EXPOSE 3000
ENTRYPOINT ["/server"]
