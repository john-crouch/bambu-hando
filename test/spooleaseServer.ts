// ABOUTME: Local stand-in for a SpoolEase console speaking the real encrypted protocol.
// ABOUTME: Keeps custom-filament and spool state like the device, and records every request.

import { createServer } from "node:http";
import type { AddressInfo } from "node:net";

import { decryptText, deriveKey, encryptText } from "../src/encryption.js";

export const TEST_SECURITY_KEY = "TESTKEY";

export interface RecordedRequest {
  method: string;
  path: string;
  body: unknown;
}

export interface SpoolEaseServer {
  port: number;
  requests: RecordedRequest[];
  /** Overrides keyed by "METHOD /path" or just "/path" (any method). */
  replies: Record<string, { status: number; body: string }>;
  /** Stored custom-filaments CSV, as SpoolEase keeps it (CRLF lines, null when unset). */
  customFilaments: string | null;
  close: () => Promise<void>;
}

export async function startSpoolEaseServer(): Promise<SpoolEaseServer> {
  const key = deriveKey(TEST_SECURITY_KEY);

  const state: SpoolEaseServer = {
    port: 0,
    requests: [],
    replies: {},
    customFilaments: null,
    close: async () => {},
  };

  // Mirrors web_app.rs: trim, normalize to CRLF, and treat empty as unset.
  function storeCustomFilaments(csv: unknown): void {
    const text = typeof csv === "string" ? csv.trim().replace(/\r\n/g, "\n").replace(/\n/g, "\r\n") : "";
    state.customFilaments = text || null;
  }

  function handle(method: string, path: string, body: unknown): string {
    if (method === "GET" && path === "/api/filaments-config") {
      return JSON.stringify({ custom_filaments: state.customFilaments });
    }
    if (method === "POST" && path === "/api/filaments-config") {
      storeCustomFilaments((body as { custom_filaments?: unknown }).custom_filaments);
    }
    return "{}";
  }

  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      const method = req.method ?? "GET";
      const path = req.url ?? "";
      let body: unknown = null;
      if (method !== "GET") {
        try {
          body = JSON.parse(decryptText(key, Buffer.concat(chunks).toString("ascii")));
        } catch {
          // A wrong security key makes decryption fail, which SpoolEase reports as unauthorized.
          res.writeHead(401);
          res.end("bad key");
          return;
        }
      }
      state.requests.push({ method, path, body });

      const override = state.replies[`${method} ${path}`] ?? state.replies[path];
      if (override && override.status >= 400) {
        res.writeHead(override.status);
        res.end(override.body);
        return;
      }
      const reply = override?.body ?? handle(method, path, body);
      res.writeHead(override?.status ?? 200);
      res.end(encryptText(key, reply));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  state.port = (server.address() as AddressInfo).port;
  state.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return state;
}
