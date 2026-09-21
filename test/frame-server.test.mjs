import test from "node:test";
import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import { once } from "node:events";
import { createFrameServer } from "../lib/frame-server.mjs";
import { routeAllowed } from "../lib/frame-canonical-proxy.mjs";

const root = new URL("../", import.meta.url);
async function listen(server) { server.listen(0, "127.0.0.1"); await once(server, "listening"); return server.address().port; }
async function close(server) { server.closeAllConnections?.(); await new Promise(resolve => server.close(resolve)); }
async function get(port, path, headers = {}) { return fetch(`http://127.0.0.1:${port}${path}`, { headers }); }
async function freePort() { const reservation = createServer(); const port = await listen(reservation); await close(reservation); return port; }

test("static server exposes only the Frame allowlist", async t => {
  const server = createFrameServer({ root: new URL("../", import.meta.url).pathname, frameOrigin: "http://127.0.0.1:0" });
  const port = await listen(server); t.after(() => close(server));
  assert.equal((await get(port, "/")).status, 200);
  assert.equal((await get(port, "/family.html")).status, 200);
  assert.equal((await get(port, "/assets/favicon.svg")).status, 200);
  assert.equal((await get(port, "/README.md")).status, 404);
  assert.equal((await get(port, "/server.mjs")).status, 404);
  assert.equal((await get(port, "/lib/frame-server.mjs")).status, 404);
});

test("canonical path allowlist denies unrelated and destructive routes", () => {
  assert.equal(routeAllowed("POST", "/v1/auth/password-login"), true);
  assert.equal(routeAllowed("GET", "/v1/viewer/spaces/space_1"), true);
  assert.equal(routeAllowed("GET", "/v1/viewer/spaces/space_1/photos/photo_1/album-media"), true);
  assert.equal(routeAllowed("GET", "/v1/viewer/spaces/space_1/stories/story_1/audio/message_1"), true);
  assert.equal(routeAllowed("GET", "/v1/spaces/space_1/photos/photo_1/notes/story_1/audio/message_1"), true);
  assert.equal(routeAllowed("POST", "/v1/spaces/space_1/archive"), false);
  assert.equal(routeAllowed("GET", "/v1/admin/accounts"), false);
  assert.equal(routeAllowed("GET", "/v1/viewer/spaces/space_1/../../admin"), false);
});

test("same-origin writes reach canonical with normalized Host/Origin, cross-site does not", async t => {
  const seen = [];
  const upstream = createServer(async (req, res) => {
    for await (const chunk of req) { if (!seen.body) seen.body = []; seen.body.push(chunk); }
    seen.push({ method: req.method, url: req.url, host: req.headers.host, origin: req.headers.origin,
      fetchSite: req.headers["sec-fetch-site"], forwarded: req.headers["x-forwarded-for"], cookie: req.headers.cookie });
    res.writeHead(200, { "content-type": "application/json", "set-cookie": ["__Host-unseen_account=fixture; Path=/; Secure; HttpOnly; SameSite=Strict"] });
    res.end('{"ok":true}');
  });
  const upstreamPort = await listen(upstream); t.after(() => close(upstream));
  const appPort = await freePort();
  const app = createFrameServer({ root: root.pathname, frameOrigin: `http://127.0.0.1:${appPort}`,
    canonicalUpstream: `http://127.0.0.1:${upstreamPort}`, canonicalOrigin: "https://unseen.maxxam.xyz" });
  await new Promise((resolve, reject) => { app.once("error", reject); app.listen(appPort, "127.0.0.1", resolve); }); t.after(() => close(app));
  const cross = await fetch(`http://127.0.0.1:${appPort}/v1/auth/password-login`, { method: "POST",
    headers: { origin: "https://evil.example", "sec-fetch-site": "cross-site", "content-type": "application/json" }, body: "{}" });
  assert.equal(cross.status, 403); assert.equal(seen.length, 0);
  const response = await fetch(`http://127.0.0.1:${appPort}/v1/auth/password-login`, { method: "POST",
    headers: { host: `127.0.0.1:${appPort}`, origin: `http://127.0.0.1:${appPort}`, "sec-fetch-site": "same-origin",
      cookie: "__Host-unseen_account=fixture", "x-forwarded-for": "198.51.100.9", "content-type": "application/json" }, body: "{\"username\":\"fixture\"}" });
  assert.equal(response.status, 200); assert.equal(response.headers.getSetCookie().length, 1);
  assert.deepEqual(seen[0], { method: "POST", url: "/v1/auth/password-login", host: "unseen.maxxam.xyz", origin: "https://unseen.maxxam.xyz",
    fetchSite: "same-origin", forwarded: "127.0.0.1", cookie: "__Host-unseen_account=fixture" });
});

test("upload ticket PUT forwards the exact narrow media path and ticket headers", async t => {
  const seen = {};
  const upstream = createServer(async (req, res) => {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    seen.method = req.method;
    seen.url = req.url;
    seen.ticket = req.headers["x-upload-ticket"];
    seen.ifNoneMatch = req.headers["if-none-match"];
    seen.body = Buffer.concat(chunks).toString();
    res.writeHead(201, { "content-type": "application/json" });
    res.end('{"stored":true}');
  });
  const upstreamPort = await listen(upstream); t.after(() => close(upstream));
  const appPort = await freePort();
  const app = createFrameServer({ root: root.pathname, frameOrigin: `http://127.0.0.1:${appPort}`,
    canonicalUpstream: `http://127.0.0.1:${upstreamPort}`, canonicalOrigin: "https://unseen.maxxam.xyz" });
  await new Promise((resolve, reject) => { app.once("error", reject); app.listen(appPort, "127.0.0.1", resolve); }); t.after(() => close(app));
  const response = await fetch(`http://127.0.0.1:${appPort}/__local/media/direct/space_1/object_1.jpg`, { method: "PUT",
    headers: { host: `127.0.0.1:${appPort}`, origin: `http://127.0.0.1:${appPort}`, "sec-fetch-site": "same-origin",
      "x-upload-ticket": "fixture-ticket", "if-none-match": "*", "content-type": "image/jpeg" }, body: "fixture-bytes" });
  assert.equal(response.status, 201);
  assert.deepEqual(seen, { method: "PUT", url: "/__local/media/direct/space_1/object_1.jpg", ticket: "fixture-ticket", ifNoneMatch: "*", body: "fixture-bytes" });
});

test("proxy is disabled unless explicitly configured", async t => {
  const server = createFrameServer({ root: root.pathname, frameOrigin: "http://127.0.0.1:4621" });
  const port = await listen(server); t.after(() => close(server));
  assert.equal((await get(port, "/v1/auth/password-login", { origin: "http://127.0.0.1:4621", "sec-fetch-site": "same-origin" })).status, 404);
});
