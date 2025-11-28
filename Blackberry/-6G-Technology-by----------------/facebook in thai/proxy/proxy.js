const express = require('express');
const { createProxyMiddleware } = require('http-proxy-middleware');
const url = require('url');
const app = express();
const PORT = process.env.PORT || 3000;

const BLOCK_PATTERNS = [/graph\.facebook\.com/i, /upload/i, /video_upload/i];

function shouldBlock(req) {
  const combined = (req.headers.host || '') + (req.url || '');
  return BLOCK_PATTERNS.some((p) => p.test(combined));
}

app.use((req, res, next) => {
  if (shouldBlock(req)) {
    console.log(`[BLOCKED] ${req.method} ${req.headers.host}${req.url}`);
    res.status(403).send('การเชื่อมต่อถูกบล็อกโดย proxy');
  } else next();
});

app.use('*', createProxyMiddleware({
  target: 'http://example.com',
  changeOrigin: true,
  router: (req) => {
    try {
      const parsed = url.parse(req.url);
      if (parsed.protocol && parsed.host) return parsed.protocol + '//' + parsed.host;
    } catch {}
    return 'http://' + req.headers.host;
  }
}));

app.listen(PORT, () => console.log(`Proxy running on port ${PORT}`));
