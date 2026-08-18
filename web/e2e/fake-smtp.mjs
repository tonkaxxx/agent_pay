import { mkdirSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const host = "127.0.0.1";
const port = 2525;
const mailboxDir = fileURLToPath(new URL(".tmp", import.meta.url));
mkdirSync(mailboxDir, { recursive: true });

function sanitizeFilename(email) {
  return String(email).toLowerCase().replace(/[^a-z0-9._-]+/g, "_");
}

const server = createServer((socket) => {
  socket.setEncoding("utf8");
  let buffer = "";
  let dataMode = false;
  let current = null;

  const send = (line) => socket.write(`${line}\r\n`);

  socket.on("data", (chunk) => {
    buffer += chunk;
    let index = buffer.search(/\r?\n/);
    while (index !== -1) {
      let line = buffer.slice(0, index);
      buffer = buffer.slice(index + (buffer[index] === "\r" ? 2 : 1));

      if (dataMode) {
        if (line === ".") {
          dataMode = false;
          if (current !== null) {
            const file = join(mailboxDir, `mailbox-${sanitizeFilename(current.rcpt)}.eml`);
            writeFileSync(file, current.data, "utf8");
            console.log(`[fake-smtp] captured message for ${current.rcpt}`);
          }
          current = null;
          send("250 2.0.0 OK: queued");
        } else {
          const unescaped = line.startsWith("..") ? line.slice(1) : line;
          if (current !== null) {
            current.data = `${current.data}${unescaped}\r\n`;
          }
        }
        index = buffer.search(/\r?\n/);
        continue;
      }

      const upper = line.toUpperCase();
      if (upper.startsWith("EHLO") || upper.startsWith("HELO")) {
        send("250-fake-smtp.local");
        send("250-8BITMIME");
        send("250 SIZE 10485760");
      } else if (upper.startsWith("AUTH")) {
        send("235 2.7.0 Authentication successful");
      } else if (upper.startsWith("MAIL FROM")) {
        send("250 2.1.0 OK");
      } else if (upper.startsWith("RCPT TO")) {
        const rcpt = line.slice(line.indexOf(":") + 1).trim().replace(/^<|>$/g, "");
        current = { rcpt, data: "" };
        send("250 2.1.5 OK");
      } else if (upper === "DATA") {
        dataMode = true;
        send("354 End data with <CR><LF>.<CR><LF>");
      } else if (upper === "QUIT") {
        send("221 2.0.0 Bye");
        socket.end();
      } else if (upper === "RSET") {
        current = null;
        send("250 2.0.0 OK");
      } else if (upper === "NOOP") {
        send("250 2.0.0 OK");
      } else {
        send("250 2.0.0 OK");
      }

      index = buffer.search(/\r?\n/);
    }
  });

  socket.on("error", () => undefined);
  send("220 fake-smtp.local ESMTP AgentPay test mailer");
});

server.listen(port, host);

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);