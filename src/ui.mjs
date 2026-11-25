import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const contentTypes = { ".css": "text/css", ".js": "text/javascript" };
const csp = [
  "default-src 'none'", "script-src 'self'", "style-src 'self' 'unsafe-inline'", "connect-src 'self'",
  "img-src 'self' data:", "font-src 'self'", "base-uri 'none'", "frame-ancestors 'none'", "form-action 'self'",
].join("; ");

export function serveConsole(app, directory = fileURLToPath(new URL("../dist/ui", import.meta.url))) {
  if (!directory || !existsSync(join(directory, "index.html"))) return false;
  const html = readFileSync(join(directory, "index.html"), "utf8");
  app.get("/", async (_request, reply) => reply.type("text/html")
    .header("content-security-policy", csp).header("cache-control", "no-cache").send(html));
  app.get("/assets/:name", async (request, reply) => {
    const name = request.params.name;
    const type = contentTypes[extname(name)];
    if (!type || !/^[\w-]+\.(css|js)$/.test(name)) return reply.code(404).send();
    const path = join(directory, "assets", name);
    if (!statSync(path, { throwIfNoEntry: false })?.isFile()) return reply.code(404).send();
    return reply.type(type).header("x-content-type-options", "nosniff")
      .header("cache-control", "public, max-age=31536000, immutable").send(createReadStream(path));
  });
  return true;
}
