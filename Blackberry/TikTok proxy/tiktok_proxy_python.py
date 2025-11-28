# Repository: tiktok-proxy-python

This single-file code document includes the main files for a simple Python reverse proxy intended to forward requests from a client (for example, a mobile app or debugging tool) to TikTok endpoints. It is provided for educational/debugging purposes only. Do not use it to violate TikTok's Terms of Service, bypass regional restrictions, or avoid security controls such as certificate pinning.

---

# File: README.md
```
# TikTok Proxy (Python)

A simple Python reverse proxy useful for debugging mobile app traffic or building a controlled proxy to forward requests to TikTok endpoints. **This project is intended for lawful, ethical use only.**

## Features
- Forwards all HTTP methods (GET/POST/PUT/DELETE/PATCH etc.)
- Preserves request headers and body (filters hop-by-hop headers)
- Streams response back to the client
- Basic logging
- Configurable target base URL

## Limitations & Important Notes
- TikTok (mobile) apps may use TLS pinning and other protections. A simple HTTP(s) proxy will **not** bypass certificate pinning.
- You must only run this on systems you control and only for traffic you are authorized to inspect.
- Using a proxy to bypass geo-restrictions or to engage in scraping or abusive behavior may be illegal and/or violate TikTok's Terms of Service.

## Requirements
- Python 3.9+
- See `requirements.txt`

## Setup
1. Create a virtual environment and install dependencies:

```bash
python -m venv venv
source venv/bin/activate    # Windows: venv\Scripts\activate
pip install -r requirements.txt
```

2. Edit `config.yaml` to set `target_base` to the TikTok endpoint you want to proxy to, for example: `https://api16-muse.tiktokv.com` (replace with actual target as needed).

3. Run the proxy

```bash
python app.py
```

By default the proxy listens on `127.0.0.1:8080`. Point your device or app (with appropriate network configuration) to this proxy.

## Upload to GitHub
1. Initialize a repo and push:

```bash
git init
git add .
git commit -m "Initial commit: TikTok proxy"
# create repo on Github and set origin
git remote add origin git@github.com:<your-username>/tiktok-proxy-python.git
git push -u origin main
```

## License
MIT (see LICENSE)
```

---

# File: requirements.txt
```
aiohttp>=3.8
PyYAML>=6.0
```

---

# File: .gitignore
```
venv/
__pycache__/
*.pyc
.env
```

---

# File: LICENSE
```
MIT License

Copyright (c) 2025

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

[Standard MIT text omitted for brevity]
```

---

# File: config.yaml
```
# Base target URL to forward to. Replace with the desired TikTok API/domain.
# Example: https://api16-normal-c-useast1a.tiktokv.com
target_base: "https://example.tiktok.com"

# Bind address and port
bind_host: "0.0.0.0"
bind_port: 8080

# Optional: rewrite Host header to target
rewrite_host: true
```

---

# File: app.py
```python
"""Simple asynchronous reverse proxy using aiohttp.

Usage:
    python app.py

This listens on bind_host:bind_port and forwards all requests to target_base
configured in config.yaml.

Note: This proxy is intentionally minimal and not production hardened.
"""
import asyncio
import logging
import sys
from aiohttp import web, ClientSession, ClientResponse
import yaml
from urllib.parse import urljoin

# configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s %(levelname)s %(message)s')
logger = logging.getLogger("tiktok-proxy")

# load config
with open("config.yaml", "r", encoding="utf-8") as f:
    cfg = yaml.safe_load(f)

TARGET_BASE = cfg.get("target_base")
BIND_HOST = cfg.get("bind_host", "0.0.0.0")
BIND_PORT = int(cfg.get("bind_port", 8080))
REWRITE_HOST = bool(cfg.get("rewrite_host", True))

# hop-by-hop headers that should not be forwarded per RFC 2616
HOP_BY_HOP = {
    'connection', 'keep-alive', 'proxy-authenticate', 'proxy-authorization', 'te',
    'trailers', 'transfer-encoding', 'upgrade'
}

async def filter_request_headers(headers):
    result = {}
    for k, v in headers.items():
        if k.lower() in HOP_BY_HOP:
            continue
        # optionally strip some headers that might cause issues
        if k.lower() == 'accept-encoding':
            # let backend respond uncompressed so we can forward raw bytes
            continue
        result[k] = v
    return result

async def handle_request(request: web.Request):
    # Build the target URL
    # request.raw_path includes path and query
    path_qs = request.raw_path
    target_url = urljoin(TARGET_BASE.rstrip('/') + '/', path_qs.lstrip('/'))

    logger.info(f"Forwarding {request.method} {request.path_qs} -> {target_url}")

    headers = await filter_request_headers(request.headers)
    if REWRITE_HOST:
        # set Host header to target host
        from urllib.parse import urlparse
        parsed = urlparse(TARGET_BASE)
        headers['Host'] = parsed.netloc

    body = await request.read()

    async with ClientSession() as session:
        try:
            async with session.request(
                request.method,
                target_url,
                headers=headers,
                data=body if body else None,
                allow_redirects=False,
                timeout=30
            ) as resp:
                return await build_response(resp)
        except Exception as e:
            logger.exception("Error forwarding request")
            return web.Response(status=502, text=f"Bad gateway: {e}")

async def build_response(resp: ClientResponse):
    # copy status
    status = resp.status
    # filter response headers
    out_headers = {}
    for k, v in resp.headers.items():
        if k.lower() in HOP_BY_HOP:
            continue
        out_headers[k] = v

    body = await resp.read()
    return web.Response(status=status, body=body, headers=out_headers)

async def init_app():
    app = web.Application()
    # route all paths
    app.router.add_route('*', '/{tail:.*}', handle_request)
    return app

if __name__ == '__main__':
    if TARGET_BASE is None or TARGET_BASE.strip() == "":
        logger.error("TARGET_BASE is not configured in config.yaml. Exiting.")
        sys.exit(1)

    app = asyncio.run(init_app())
    logger.info(f"Starting proxy on {BIND_HOST}:{BIND_PORT}, forwarding to {TARGET_BASE}")
    web.run_app(app, host=BIND_HOST, port=BIND_PORT)
```

---

# End of repository files

# Notes (not included in repository files):
# - This proxy does not implement HTTPS interception (i.e., acting as a TLS terminating proxy with a generated CA).
#   To intercept HTTPS from mobile apps you would need to implement a TLS MITM proxy, install a custom CA on the device,
#   and also bypass certificate pinning where present. Doing so may violate app terms and local law.
# - If you want TLS MITM for debugging, consider using an established tool such as mitmproxy which handles certificate generation,
#   UI, scripting, and easier device setup.

