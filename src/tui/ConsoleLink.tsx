// ABOUTME: Clickable SpoolEase console links: the console's web URL and text whose parts can open a URL.
// ABOUTME: Terminals without hyperlinks show exactly the text, with no URL after it, so widths never change.

import { isIP } from "node:net";

import Link from "ink-link";

import type { SpoolEaseConnection } from "../spoolease.js";

/** A piece of a line: plain text, or text that opens `url` where the terminal supports links. */
export type TextPart = string | { text: string; url: string };

/** The console's web UI, with the port only when it's a valid port other than the scheme's default. */
export function consoleUrl({ host, port, https }: SpoolEaseConnection): string {
  const scheme = https ? "https" : "http";
  const bare = host.replace(/^\[|\]$/g, "");
  // An IPv6 address goes in brackets, its zone ID's "%" written "%25" (RFC 6874).
  const name = isIP(bare.split("%")[0] ?? "") === 6 ? `[${bare.replace(/%(?!25)/, "%25")}]` : host;
  const shown = Number.isInteger(port) && port > 0 && port <= 65535 && port !== (https ? 443 : 80);
  return shown ? `${scheme}://${name}:${port}` : `${scheme}://${name}`;
}

/** What the parts show on screen. */
export function partsText(parts: TextPart[]): string {
  return parts.map((part) => (typeof part === "string" ? part : part.text)).join("");
}

/** The parts as children of an enclosing `<Text>`, which keeps its own styling and wrapping. */
export function LinkedText({ parts }: { parts: TextPart[] }) {
  return (
    <>
      {parts.map((part, index) =>
        typeof part === "string" ? (
          part
        ) : (
          // biome-ignore lint/suspicious/noArrayIndexKey: parts are a fixed sequence built per render; the position is their identity.
          <Link key={index} url={part.url} fallback={false}>
            {part.text}
          </Link>
        ),
      )}
    </>
  );
}
