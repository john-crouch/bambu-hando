// ABOUTME: Tests the design system's SpoolEase console link: the URL it opens and the plain text it falls back to.
// ABOUTME: Hyperlinks are switched off here (FORCE_HYPERLINK=0), as in tests, PTYs and CI terminals.

import { Text } from "ink";
import { render } from "ink-testing-library";
import { describe, expect, it, vi } from "vitest";

vi.hoisted(() => {
  process.env.FORCE_HYPERLINK = "0";
});

import { consoleUrl, LinkedText, partsText } from "../src/tui/ui/ConsoleLink.js";

const conn = (host: string, port: number, https = false) => ({
  host,
  port,
  securityKey: "secret",
  https,
});

describe("consoleUrl", () => {
  it("leaves out the default port for http and https", () => {
    expect(consoleUrl(conn("spoolease.local", 80))).toBe("http://spoolease.local");
    expect(consoleUrl(conn("spoolease.local", 443, true))).toBe("https://spoolease.local");
  });

  it("keeps a port that isn't the scheme's default", () => {
    expect(consoleUrl(conn("192.168.1.20", 8080))).toBe("http://192.168.1.20:8080");
    expect(consoleUrl(conn("spoolease.local", 80, true))).toBe("https://spoolease.local:80");
    expect(consoleUrl(conn("spoolease.local", 443))).toBe("http://spoolease.local:443");
  });

  it("brackets an IPv6 address", () => {
    expect(consoleUrl(conn("fe80::1", 8080))).toBe("http://[fe80::1]:8080");
    expect(consoleUrl(conn("[fe80::1]", 80))).toBe("http://[fe80::1]");
  });

  it("percent-encodes an IPv6 zone ID (RFC 6874)", () => {
    expect(consoleUrl(conn("fe80::1%eth0", 8080))).toBe("http://[fe80::1%25eth0]:8080");
    expect(consoleUrl(conn("[fe80::1%eth0]", 80))).toBe("http://[fe80::1%25eth0]");
    expect(consoleUrl(conn("[fe80::1%25eth0]", 80))).toBe("http://[fe80::1%25eth0]");
  });

  it("brackets only an IPv6 address, not a host typed with a colon in it", () => {
    expect(consoleUrl(conn("spoolease.local:8080", 80))).not.toContain("[");
  });

  it("leaves out a port that isn't a valid one, as when the field is blank", () => {
    expect(consoleUrl(conn("spoolease.local", Number.NaN))).toBe("http://spoolease.local");
    expect(consoleUrl(conn("spoolease.local", 0))).toBe("http://spoolease.local");
    expect(consoleUrl(conn("spoolease.local", 70000))).toBe("http://spoolease.local");
  });

  it("never carries the security key", () => {
    expect(consoleUrl(conn("host", 80))).not.toContain("secret");
  });
});

describe("without hyperlink support", () => {
  it("shows exactly the text, with no URL after it", () => {
    const { lastFrame } = render(
      <Text>
        <LinkedText parts={["SpoolEase: ", { text: "host", url: "http://host:8080" }, " (x)"]} />
      </Text>,
    );
    expect(lastFrame()).toBe("SpoolEase: host (x)");
  });

  it("joins the parts into the visible text", () => {
    expect(partsText(["a ", { text: "b", url: "http://b" }, " c"])).toBe("a b c");
  });
});
