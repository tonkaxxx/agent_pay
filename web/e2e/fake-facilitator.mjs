import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4022;
const headers = {
  "cache-control": "no-store",
  "content-type": "application/json",
};

const supported = {
  kinds: [{ x402Version: 2, scheme: "exact", network: "eip155:8453" }],
  extensions: [],
  signers: {
    "eip155:8453": ["0x0000000000000000000000000000000000000001"],
  },
};

const server = createServer((request, response) => {
  if (request.method === "GET" && request.url === "/healthz") {
    response.writeHead(200, headers);
    response.end(JSON.stringify({ status: "ok" }));
    return;
  }

  if (request.method === "GET" && request.url === "/supported") {
    response.writeHead(200, headers);
    response.end(JSON.stringify(supported));
    return;
  }

  response.writeHead(404, headers);
  response.end(JSON.stringify({ error: "not_found" }));
});

server.listen(port, host);

function shutdown() {
  server.close(error => {
    process.exitCode = error ? 1 : 0;
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
