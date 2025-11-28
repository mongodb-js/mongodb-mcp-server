// Cloudflare Worker Proxy for Techasit AI by BlackBerry
const TECHASIT_API_URL = Deno.env.get("TECHASIT_API_URL") || "https://api.techasit.example/v1";
const AUTH_HEADER = Deno.env.get("TECHASIT_API_KEY") || "";

export default {
  async fetch(request) {
    try {
      const url = new URL(request.url);
      const targetUrl = `${TECHASIT_API_URL}${url.pathname}${url.search}`;

      const reqInit = {
        method: request.method,
        headers: new Headers(request.headers),
        body: request.method === "GET" || request.method === "HEAD" ? undefined : await request.arrayBuffer(),
        redirect: "follow"
      };

      if (AUTH_HEADER) reqInit.headers.set("Authorization", `Bearer ${AUTH_HEADER}`);
      reqInit.headers.set("Accept", "application/json");
      reqInit.headers.delete("Host");

      const resp = await fetch(targetUrl, reqInit);

      const responseHeaders = new Headers(resp.headers);
      responseHeaders.set("Access-Control-Allow-Origin", "*");
      responseHeaders.set("Access-Control-Allow-Methods", "GET,POST,PUT,DELETE,OPTIONS");
      responseHeaders.set("Access-Control-Allow-Headers", "Content-Type, Authorization");

      const body = await resp.arrayBuffer();
      return new Response(body, { status: resp.status, headers: responseHeaders });
    } catch (err) {
      return new Response(JSON.stringify({ error: "proxy_error", message: String(err) }), {
        status: 502,
        headers: { "Content-Type": "application/json" }
      });
    }
  }
};
