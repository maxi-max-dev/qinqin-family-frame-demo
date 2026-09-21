import { fileURLToPath } from "node:url";
import { dirname } from "node:path";
import { createFrameServer } from "./lib/frame-server.mjs";

const port = Number(process.env.PORT ?? 4620);
const host = process.env.FRAME_BIND_HOST ?? "127.0.0.1";
if (!/^(?:127\.0\.0\.1|localhost|::1)$/u.test(host)) throw new Error("frame_bind_must_be_loopback");
const frameOrigin = process.env.FRAME_PUBLIC_ORIGIN ?? `http://${host}:${port}`;
const root = process.env.FRAME_STATIC_ROOT ?? dirname(fileURLToPath(import.meta.url));
const proxyEnabled = process.env.FRAME_ENABLE_CANONICAL_PROXY === "1";
if (proxyEnabled && (!process.env.CANONICAL_UPSTREAM || !process.env.CANONICAL_PUBLIC_ORIGIN)) {
  throw new Error("canonical_proxy_requires_explicit_upstream_and_origin");
}
const server = createFrameServer({ root, frameOrigin,
  canonicalUpstream: proxyEnabled ? process.env.CANONICAL_UPSTREAM : null,
  canonicalOrigin: proxyEnabled ? process.env.CANONICAL_PUBLIC_ORIGIN : null });
server.listen(port, host, () => process.stdout.write(JSON.stringify({ ready: true, origin: frameOrigin, root, proxy: proxyEnabled }) + "\n"));
const stop = () => server.close(() => process.exit(0));
process.once("SIGTERM", stop);
process.once("SIGINT", stop);
