import { readFileSync } from "node:fs";
import { createServer } from "node:https";

const key = readFileSync("/certs/server.key", "utf8");
const cert = readFileSync("/certs/server.pem", "utf8");

const server = createServer({ key, cert }, (request, response) => {
  response.writeHead(200, {
    "content-type": "application/json",
    "cache-control": "no-store",
  });
  response.end('{"status":"ok"}\n');
});

server.listen(443, "0.0.0.0", () => {
  console.log("[fake-upstream] listening on :443");
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);