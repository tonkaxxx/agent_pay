import { createServer } from "node:http";
import { createHash } from "node:crypto";

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

function readJson(request) {
  return new Promise((resolve, reject) => {
    let raw = "";
    request.setEncoding("utf8");
    request.on("data", chunk => {
      raw += chunk;
    });
    request.on("end", () => {
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    request.on("error", reject);
  });
}

const server = createServer(async (request, response) => {
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

  if (request.method === "POST" && request.url === "/verify") {
    await readJson(request);
    response.writeHead(200, headers);
    response.end(JSON.stringify({
      isValid: true,
      payer: "0x2222222222222222222222222222222222222222",
    }));
    return;
  }

  if (request.method === "POST" && request.url === "/settle") {
    const payment = await readJson(request);
    const transaction = createHash("sha256").update(JSON.stringify(payment)).digest("hex");
    response.writeHead(200, headers);
    response.end(JSON.stringify({
      success: true,
      payer: "0x2222222222222222222222222222222222222222",
      transaction: `0x${transaction}`,
      network: "eip155:8453",
    }));
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
