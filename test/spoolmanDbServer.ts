// ABOUTME: Local HTTP server that serves SpoolmanDB's compiled JSON files like GitHub Pages does.
// ABOUTME: Sends ETags, answers If-None-Match with 304, records requests, and can be told to fail.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createServer, type IncomingHttpHeaders } from "node:http";
import type { AddressInfo } from "node:net";

export const SPOOLMANDB_FIXTURE_DIR = new URL("./fixtures/spoolmandb/", import.meta.url);

export interface SpoolmanDbServer {
  url: string;
  requests: { path: string; headers: IncomingHttpHeaders }[];
  /** Files served by path, e.g. "/filaments.json"; defaults to the fixtures. */
  files: Map<string, string>;
  /** When set, every request gets this status and an empty body. */
  failWith: number | null;
  close: () => Promise<void>;
}

function etag(body: string): string {
  return `"${createHash("md5").update(body).digest("hex")}"`;
}

export async function startSpoolmanDbServer(): Promise<SpoolmanDbServer> {
  const files = new Map(
    ["filaments.json", "materials.json"].map((name) => [`/${name}`, readFileSync(new URL(name, SPOOLMANDB_FIXTURE_DIR), "utf-8")]),
  );
  const state: Omit<SpoolmanDbServer, "url" | "close"> = { requests: [], files, failWith: null };

  const server = createServer((req, res) => {
    const path = req.url ?? "/";
    state.requests.push({ path, headers: req.headers });
    if (state.failWith !== null) {
      res.writeHead(state.failWith);
      res.end();
      return;
    }
    const body = state.files.get(path);
    if (body === undefined) {
      res.writeHead(404);
      res.end();
      return;
    }
    const tag = etag(body);
    if (req.headers["if-none-match"] === tag) {
      res.writeHead(304, { ETag: tag });
      res.end();
      return;
    }
    res.writeHead(200, { "Content-Type": "application/json; charset=utf-8", ETag: tag });
    res.end(body);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;

  return Object.assign(state, {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  });
}
