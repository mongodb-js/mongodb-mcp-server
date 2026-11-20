# Build the workspace from the repo's lockfile (so the image matches CI) into a self-contained prod
# tree. Done in-image because buildx builds per platform.
FROM node:24-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY . .
RUN pnpm install --frozen-lockfile
RUN pnpm build
RUN pnpm --filter mongodb-mcp-server deploy --prod --node-linker=hoisted /deploy
# kerberos can't build on Alpine (no musl prebuild); drop the unbuilt package, as the old image did.
RUN rm -rf /deploy/node_modules/kerberos

FROM node:24-alpine
ARG VERSION=latest
RUN apk upgrade --no-cache
RUN addgroup -S mcp && adduser -S mcp -G mcp
COPY --from=build /deploy /opt/mongodb-mcp-server
RUN chmod +x /opt/mongodb-mcp-server/dist/esm/index.js \
 && ln -s /opt/mongodb-mcp-server/dist/esm/index.js /usr/local/bin/mongodb-mcp-server
USER mcp
WORKDIR /home/mcp
ENV MDB_MCP_LOGGERS=stderr,mcp
ENTRYPOINT ["mongodb-mcp-server"]
LABEL maintainer="MongoDB Inc <info@mongodb.com>"
LABEL description="Official MongoDB MCP server: let AI agents search and manage databases and the Atlas data platform"
LABEL version=${VERSION}
LABEL io.modelcontextprotocol.server.name="io.github.mongodb-js/mongodb-mcp-server"
