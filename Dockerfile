FROM node:22-alpine

ARG VERSION=latest

# Create mcp user and group
RUN addgroup -S mcp && adduser -S mcp -G mcp

# Install the MongoDB MCP server globally
RUN npm install -g mongodb-mcp-server@${VERSION}

# Install wget for health checks
RUN apk add --no-cache wget

# Switch to mcp user
USER mcp
WORKDIR /home/mcp

# Expose port for Railway health checks
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Set the entrypoint
ENTRYPOINT ["mongodb-mcp-server"]

# Labels
LABEL maintainer="MongoDB Inc <info@mongodb.com>"
LABEL description="MongoDB MCP Server"
LABEL version=${VERSION}
