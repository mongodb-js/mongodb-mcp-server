FROM node:22-alpine

ARG VERSION=latest

# Install system dependencies
RUN apk add --no-cache wget curl

# Create mcp user and group
RUN addgroup -S mcp && adduser -S mcp -G mcp

# Install the MongoDB MCP server globally
RUN npm install -g mongodb-mcp-server@${VERSION}

# Create a simple wrapper script that works with Railway
RUN cat > /usr/local/bin/railway-wrapper.js << 'EOF'
#!/usr/bin/env node

const http = require('http');
const { spawn } = require('child_process');

// Get package info
let packageInfo;
try {
  packageInfo = require('/usr/local/lib/node_modules/mongodb-mcp-server/package.json');
} catch (err) {
  packageInfo = { version: 'unknown' };
}

console.log('MongoDB MCP Server Railway Wrapper starting...');
console.log('Environment variables:');
console.log('- PORT:', process.env.PORT || 'not set');
console.log('- MONGODB_URI:', process.env.MONGODB_URI ? 'set' : 'not set');

// Health check server for Railway
const server = http.createServer((req, res) => {
  console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
  
  if (req.url === '/health' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({
      status: 'healthy',
      service: 'mongodb-mcp-server',
      version: packageInfo.version,
      timestamp: new Date().toISOString(),
      environment: {
        port: process.env.PORT,
        mongodb_connected: !!process.env.MONGODB_URI
      }
    }));
  } else if (req.url === '/' && req.method === 'GET') {
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(`
      <html>
        <head><title>MongoDB MCP Server</title></head>
        <body>
          <h1>MongoDB MCP Server</h1>
          <p>Version: ${packageInfo.version}</p>
          <p>Status: Running</p>
          <p>MongoDB: ${process.env.MONGODB_URI ? 'Connected' : 'Not configured'}</p>
          <p><a href="/health">Health Check</a></p>
        </body>
      </html>
    `);
  } else {
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('Not Found');
  }
});

const port = process.env.PORT || 3000;

server.listen(port, '0.0.0.0', () => {
  console.log(`Health check server listening on port ${port}`);
  console.log(`MongoDB MCP Server v${packageInfo.version} wrapper started`);
  console.log(`Access your service at: http://localhost:${port}`);
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

// Handle graceful shutdown
process.on('SIGTERM', () => {
  console.log('Received SIGTERM, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('Received SIGINT, shutting down gracefully');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

console.log('MongoDB MCP Server wrapper started successfully');
EOF

RUN chmod +x /usr/local/bin/railway-wrapper.js

# Switch to mcp user
USER mcp
WORKDIR /home/mcp

# Expose port for Railway
EXPOSE 3000

# Add health check
HEALTHCHECK --interval=30s --timeout=3s --start-period=10s --retries=3 \
    CMD wget --no-verbose --tries=1 --spider http://localhost:3000/health || exit 1

# Use the wrapper script
ENTRYPOINT ["node", "/usr/local/bin/railway-wrapper.js"]

# Labels
LABEL maintainer="MongoDB Inc <info@mongodb.com>"
LABEL description="MongoDB MCP Server for Railway"
LABEL version=${VERSION}
