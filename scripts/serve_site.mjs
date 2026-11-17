// Serve site/ on http://localhost:4173 to try the browser demo locally.
//
//   node scripts/serve_site.mjs [port]

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { dirname, extname, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";

const site = join(dirname(fileURLToPath(import.meta.url)), "..", "site");
const port = Number(process.argv[2]) || 4173;
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".css": "text/css",
  ".json": "application/json", ".svg": "image/svg+xml", ".mp3": "audio/mpeg", ".onnx": "application/octet-stream",
  ".data": "application/octet-stream", ".wasm": "application/wasm" };

createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
  if (path.endsWith("/")) path += "index.html";
  const file = normalize(join(site, path));
  if (!file.startsWith(site)) { response.writeHead(403).end(); return; }
  try {
    const bytes = await readFile(file);
    response.writeHead(200, { "content-type": TYPES[extname(file)] || "text/plain; charset=utf-8", "content-length": bytes.length, "cache-control": "no-store" });
    response.end(bytes);
  } catch {
    response.writeHead(404, { "content-type": "text/plain" }).end("not found");
  }
}).listen(port, () => console.log(`http://localhost:${port}`));
