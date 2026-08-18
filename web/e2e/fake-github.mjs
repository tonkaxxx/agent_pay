import { createServer } from "node:http";

const host = "127.0.0.1";
const port = 4200;
const clientId = "test-e2e-github-client";
const clientSecret = "test-e2e-github-client-secret";
const user = {
  id: 1,
  login: "test-seller",
  name: "Test Seller",
  email: "seller@agentpay.test",
  avatar_url: null,
};

function isAuthorized(request) {
  return (
    request.headers.authorization ===
    `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString("base64")}`
  );
}

const server = createServer((request, response) => {
  const url = new URL(request.url ?? "/", `http://${host}:${port}`);
  const path = url.pathname;

  if (path === "/login/oauth/authorize" && request.method === "GET") {
    const redirectUri = url.searchParams.get("redirect_uri") ?? "";
    const state = url.searchParams.get("state") ?? "";
    const code = "test-authorization-code";
    const callback = new URL(redirectUri);
    callback.searchParams.set("code", code);
    callback.searchParams.set("state", state);
    response.writeHead(302, { location: callback.toString() });
    response.end();
    return;
  }

  if (path === "/login/oauth/access_token" && request.method === "POST") {
    if (!isAuthorized(request)) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ error: "invalid_client" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(
      JSON.stringify({
        access_token: "test-access-token",
        token_type: "Bearer",
        scope: "read:user user:email",
        expires_in: 3600,
      }),
    );
    return;
  }

  if (path === "/api/v3/user" && request.method === "GET") {
    if (!request.headers.authorization?.startsWith("Bearer ")) {
      response.writeHead(401, { "content-type": "application/json" });
      response.end(JSON.stringify({ message: "Bad credentials" }));
      return;
    }
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify(user));
    return;
  }

  if (path === "/api/v3/user/emails" && request.method === "GET") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end(JSON.stringify([{ email: user.email, primary: true, verified: true }]));
    return;
  }

  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ message: "not_found" }));
});

server.listen(port, host);

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
