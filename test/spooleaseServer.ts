// ABOUTME: Local stand-in for a SpoolEase console speaking the real encrypted protocol.
// ABOUTME: Decrypts and records requests, and replies with configurable encrypted responses.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { decryptText, deriveKey, encryptText } from "../src/encryption.js";

export const TEST_SECURITY_KEY = "TESTKEY";

export interface RecordedRequest {
  path: string;
  body: unknown;
}

export interface SpoolEaseServer {
  port: number;
  requests: RecordedRequest[];
  replies: Record<string, { status: number; body: string }>;
  close: () => Promise<void>;
}

export async function startSpoolEaseServer(): Promise<SpoolEaseServer> {
  const key = deriveKey(TEST_SECURITY_KEY);
  const requests: RecordedRequest[] = [];
  const replies: SpoolEaseServer["replies"] = {};

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const path = req.url ?? "";
      let body: unknown;
      try {
        body = JSON.parse(decryptText(key, Buffer.concat(chunks).toString("ascii")));
      } catch {
        // A wrong security key makes decryption fail, which SpoolEase reports as unauthorized.
        res.writeHead(401);
        res.end("bad key");
        return;
      }
      requests.push({ path, body });
      const reply = replies[path] ?? { status: 200, body: "{}" };
      res.writeHead(reply.status);
      res.end(reply.status < 400 ? encryptText(key, reply.body) : reply.body);
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return {
    port,
    requests,
    replies,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
