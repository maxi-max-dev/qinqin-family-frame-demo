import { createServer } from "node:http";
import { readFile, realpath, stat } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { createCanonicalProxy } from "./frame-canonical-proxy.mjs";

const STATIC_FILES = new Map([
  ["/", "index.html"], ["/index.html", "index.html"], ["/family.html", "family.html"],
  ["/styles.css", "styles.css"], ["/family.css", "family.css"],
  ["/app.js", "app.js"], ["/family.js", "family.js"]
]);
const ASSET = /^\/assets\/[A-Za-z0-9._-]+\.(?:jpg|jpeg|png|webp|svg|ico)$/u;
const MIME = Object.freeze({ ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8",
  ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".png": "image/png", ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon" });

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

async function serveStatic(req, res, root, url) {
  if (req.method !== "GET" && req.method !== "HEAD") return json(res, 405, { error: { code: "method_not_allowed" } });
  const relativePath = STATIC_FILES.get(url.pathname) ?? (ASSET.test(url.pathname) ? url.pathname.slice(1) : null);
  if (!relativePath) return json(res, 404, { error: { code: "not_found" } });
  const candidate = join(root, relativePath);
  const rootReal = await realpath(root);
  const fileReal = await realpath(candidate).catch(() => null);
  if (!fileReal || (relative(rootReal, fileReal).startsWith("..") || relative(rootReal, fileReal).includes(".."))) return json(res, 404, { error: { code: "not_found" } });
  const info = await stat(fileReal).catch(() => null);
  if (!info?.isFile()) return json(res, 404, { error: { code: "not_found" } });
  const headers = { "content-type": MIME[extname(fileReal).toLowerCase()] ?? "application/octet-stream", "cache-control": "no-store", "content-length": String(info.size), "x-content-type-options": "nosniff" };
  res.writeHead(200, headers);
  if (req.method === "HEAD") return res.end();
  res.end(await readFile(fileReal));
}

export function createFrameServer({ root, frameOrigin, canonicalUpstream = null, canonicalOrigin = null } = {}) {
  if (!root || !frameOrigin) throw new Error("frame_server_config_invalid");
  const proxy = canonicalUpstream && canonicalOrigin
    ? createCanonicalProxy({ frameOrigin, upstream: canonicalUpstream, canonicalOrigin }) : null;
  const frameUrl = new URL(frameOrigin);
  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? "/", frameUrl);
      if (url.origin !== frameUrl.origin || !url.pathname.startsWith("/")) return json(res, 400, { error: { code: "request_target_invalid" } });
      if (url.pathname === "/healthz") return json(res, 200, { status: "ok", listener: "loopback_only", proxy: Boolean(proxy) });
      if (proxy && (url.pathname.startsWith("/v1/") || url.pathname === "/v1" || url.pathname.startsWith("/__local/") || url.pathname.startsWith("/__local-operable/"))) return proxy(req, res, url);
      return serveStatic(req, res, root, url);
    } catch { if (!res.headersSent) json(res, 500, { error: { code: "frame_server_error" } }); else res.destroy(); }
  });
  return server;
}
