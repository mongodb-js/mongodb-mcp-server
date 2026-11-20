FROM node:24-alpine
ARG VERSION=latest
RUN apk upgrade --no-cache
RUN addgroup -S mcp && adduser -S mcp -G mcp
RUN npm install -g mongodb-mcp-server@${VERSION}
USER mcp
WORKDIR /home/mcp
ENV MDB_MCP_LOGGERS=stderr,mcp
ENTRYPOINT ["mongodb-mcp-server"]
LABEL maintainer="MongoDB Inc <info@mongodb.com>"
LABEL description="Official MongoDB MCP server: let AI agents search and manage databases and the Atlas data platform"
LABEL version=${VERSION}
LABEL io.modelcontextprotocol.server.name="io.github.mongodb-js/mongodb-mcp-server"
LABEL org.opencontainers.image.source="https://github.com/mongodb-js/mongodb-mcp-server"
LABEL org.opencontainers.image.licenses="Apache-2.0"
