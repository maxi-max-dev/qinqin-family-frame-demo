import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { isIP } from "node:net";

const SAFE_ID = "[A-Za-z0-9_-]+";
const API_ROUTES = [
  ["POST", /^\/v1\/auth\/(?:otp-verification-challenges|email-otp-challenges|email-otp-verifications|password-login|register|logout)$/u],
  ["GET", /^\/v1\/(?:me|me\/spaces|profile)$/u],
  ["PATCH", /^\/v1\/profile$/u],
  ["GET", new RegExp(`^\\/v1\\/viewer\\/spaces\\/${SAFE_ID}(?:\\/stories|\\/stories\\/${SAFE_ID}\\/audio\\/${SAFE_ID}|\\/photos\\/${SAFE_ID}(?:\\/(?:media|album-media|video|scene-context))?)?$`, "u")],
  ["GET", new RegExp(`^\\/v1\\/spaces\\/${SAFE_ID}\\/upload-context$`, "u")],
  ["POST", /^\/v1\/consent-events$/u],
  ["POST", new RegExp(`^\\/v1\\/spaces\\/${SAFE_ID}\\/contribution-batches$`, "u")],
  ["GET", new RegExp(`^\\/v1\\/contribution-batches\\/${SAFE_ID}\\/result$`, "u")],
  ["POST", new RegExp(`^\\/v1\\/contribution-batches\\/${SAFE_ID}\\/items$`, "u")],
  ["POST", new RegExp(`^\\/v1\\/contribution-batches\\/${SAFE_ID}\\/items\\/${SAFE_ID}\\/upload-sessions$`, "u")],
  ["POST", new RegExp(`^\\/v1\\/upload-sessions\\/${SAFE_ID}\\/commits$`, "u")],
  ["POST", new RegExp(`^\\/v1\\/contribution-batches\\/${SAFE_ID}\\/finalizations$`, "u")],
  ["POST", /^\/v1\/batch-receipt-exchanges$/u],
  ["GET", /^\/v1\/batch-receipt(?:\/.*)?$/u],
  ["POST", new RegExp(`^\\/v1\\/spaces\\/${SAFE_ID}\\/photos\\/${SAFE_ID}\\/notes$`, "u")],
  ["GET", new RegExp(`^\\/v1\\/spaces\\/${SAFE_ID}\\/photos\\/${SAFE_ID}\\/notes$`, "u")],
  ["GET", new RegExp(`^\\/v1\\/spaces\\/${SAFE_ID}\\/photos\\/${SAFE_ID}\\/notes\\/${SAFE_ID}\\/audio\\/${SAFE_ID}$`, "u")],
  ["POST", new RegExp(`^\\/v1\\/photo-stories\\/${SAFE_ID}\\/withdrawals$`, "u")]
];

const MEDIA_ROUTES = [
  ["PUT", /^\/__local\/media\/direct\/[A-Za-z0-9._~%/-]+$/u],
  ["GET", /^\/__local-operable\/private-media\/[A-Za-z0-9_./-]+$/u],
  ["GET", new RegExp(`^\\/v1\\/moment-media\\/${SAFE_ID}(?:\\/preview)?$`, "u")]
];

const DROP_HEADERS = new Set([
  "connection", "keep-alive", "proxy-authenticate", "proxy-authorization", "te", "trailer",
  "transfer-encoding", "upgrade", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto",
  "x-huijian-visitor"
]);

function json(res, status, body) {
  const payload = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" });
  res.end(payload);
}

function routeAllowed(method, pathname) {
  let decoded;
  try { decoded = decodeURIComponent(pathname); } catch { return false; }
  if (decoded.split("/").some(segment => segment === "." || segment === "..")) return false;
  return [...API_ROUTES, ...MEDIA_ROUTES].some(([verb, pattern]) => verb === method && pattern.test(pathname));
}

function parseOrigin(value, label) {
  const parsed = new URL(value);
  if (!/^https?:$/u.test(parsed.protocol) || parsed.pathname !== "/" || parsed.search || parsed.hash || parsed.username || parsed.password) {
    throw new Error(`${label}_invalid`);
  }
  return parsed;
}

function sourceIp(req) {
  const address = req.socket.remoteAddress?.replace(/^::ffff:/u, "");
  return isIP(address) ? address : "127.0.0.1";
}

function frameRequestAllowed(req, frameOrigin) {
  const host = req.headers.host;
  if (host !== frameOrigin.host) return false;
  const origin = req.headers.origin;
  if (origin && origin !== frameOrigin.origin) return false;
  const fetchSite = req.headers["sec-fetch-site"];
  if (fetchSite && fetchSite !== "same-origin") return false;
  if (!["GET", "HEAD"].includes(req.method) && (!origin || origin !== frameOrigin.origin || fetchSite !== "same-origin")) return false;
  return true;
}

export function createCanonicalProxy({ frameOrigin, upstream, canonicalOrigin }) {
  const frame = parseOrigin(frameOrigin, "frame_origin");
  const targetBase = parseOrigin(upstream, "canonical_upstream");
  const canonical = parseOrigin(canonicalOrigin, "canonical_public_origin");
  const request = targetBase.protocol === "https:" ? httpsRequest : httpRequest;

  return function proxy(req, res, url) {
    if (!frameRequestAllowed(req, frame)) return json(res, 403, { error: { code: "origin_not_allowed" } });
    if (!routeAllowed(req.method, url.pathname)) return json(res, 404, { error: { code: "route_unavailable" } });

    const headers = {};
    for (const [key, value] of Object.entries(req.headers)) if (!DROP_HEADERS.has(key)) headers[key] = value;
    headers.host = canonical.host;
    headers.origin = canonical.origin;
    headers["sec-fetch-site"] = "same-origin";
    headers["x-forwarded-proto"] = canonical.protocol === "https:" ? "https" : "http";
    headers["x-forwarded-for"] = sourceIp(req);
    headers["accept-encoding"] = "identity";

    const outgoing = request({ hostname: targetBase.hostname, port: targetBase.port || undefined,
      path: `${url.pathname}${url.search}`, method: req.method, headers, timeout: 60_000 }, (incoming) => {
      const responseHeaders = { ...incoming.headers, "cache-control": "no-store" };
      delete responseHeaders.connection;
      delete responseHeaders["transfer-encoding"];
      if (responseHeaders.location) {
        try {
          const location = new URL(responseHeaders.location, canonical);
          if (location.origin === canonical.origin) responseHeaders.location = `${location.pathname}${location.search}${location.hash}`;
          else delete responseHeaders.location;
        } catch { delete responseHeaders.location; }
      }
      res.writeHead(incoming.statusCode ?? 502, responseHeaders);
      incoming.pipe(res);
    });
    outgoing.on("timeout", () => outgoing.destroy(new Error("canonical_timeout")));
    outgoing.on("error", () => { if (!res.headersSent) json(res, 502, { error: { code: "canonical_unavailable" } }); else res.destroy(); });
    req.once("aborted", () => outgoing.destroy());
    res.once("close", () => { if (!res.writableEnded) outgoing.destroy(); });
    req.pipe(outgoing);
  };
}

export { API_ROUTES, MEDIA_ROUTES, routeAllowed, frameRequestAllowed };
