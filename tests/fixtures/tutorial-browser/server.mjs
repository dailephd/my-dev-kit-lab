// Static file server for the tutorial browser fixture. Node built-ins only.
//
// Serves from its own directory, which after prepare is the run-owned
// disposable copy of the app -- never this source fixture directory.
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.TUTORIAL_FIXTURE_PORT || 0);

const server = http.createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://127.0.0.1");
  if (url.pathname === "/api/status") {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ ok: true, widgets: 3 }));
    return;
  }
  const filePath = url.pathname === "/" ? path.join(root, "index.html") : path.join(root, url.pathname);
  fs.readFile(filePath, (error, contents) => {
    if (error) {
      res.writeHead(404, { "content-type": "text/plain" });
      res.end("not found");
      return;
    }
    res.writeHead(200, {
      "content-type": filePath.endsWith(".html") ? "text/html" : "application/octet-stream"
    });
    res.end(contents);
  });
});

server.listen(port, "127.0.0.1", () => {
  console.log("tutorial fixture listening on " + server.address().port);
});
