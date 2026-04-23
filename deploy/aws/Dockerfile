# AWS-optimized MongoDB MCP Server Dockerfile
FROM node:24-alpine
ARG VERSION=latest

# Create user and group
RUN addgroup -S mcp && adduser -S mcp -G mcp

# Install production dependencies only
RUN npm install -g mongodb-mcp-server@latest
WORKDIR /home/mcp

ENV MDB_MCP_LOGGERS=stderr,mcp
ENV MDB_MCP_DISABLED_TOOLS=atlas-local
ENV MDB_MCP_EXTERNALLY_MANAGED_SESSIONS=true
ENV MDB_MCP_HTTP_RESPONSE_TYPE=json
ENV MDB_MCP_TRANSPORT=http
ENV MDB_MCP_HTTP_HOST=0.0.0.0
ENV MDB_MCP_HTTP_PORT=8000

# Run as non-root user
USER mcp
LABEL maintainer="MongoDB Inc <info@mongodb.com>"
LABEL description="MongoDB MCP Server"
LABEL version=${VERSION}
LABEL io.modelcontextprotocol.server.name="io.github.mongodb-js/mongodb-mcp-server"
# Signal that this is running in Docker for host binding logic
ENV DOCKER_CONTAINER=1

EXPOSE 8000

ENTRYPOINT ["mongodb-mcp-server"]
