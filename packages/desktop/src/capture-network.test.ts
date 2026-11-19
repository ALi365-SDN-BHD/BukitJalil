import http from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import {
  blockedAddress,
  CAPTURE_LIMITS,
  CaptureNetwork,
  CaptureNetworkError,
  captureUrl,
  isLocalName,
} from "./capture-network.ts";

const servers: http.Server[] = [];
afterEach(() => {
  for (const server of servers.splice(0)) server.close();
});

function localServer(body = "hello"): Promise<number> {
  const server = http.createServer((req, res) => {
    if (req.url === "/redirect") {
      res.writeHead(302, { location: "http://10.0.0.1/" });
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/plain" });
    res.end(body);
  });
  servers.push(server);
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      resolve(address && typeof address !== "string" ? address.port : 0);
    });
  });
}

describe("capture addresses (design 6.2)", () => {
  it("refuses loopback, private, link-local, multicast and special addresses", () => {
    for (const ip of [
      "127.0.0.1",
      "10.1.2.3",
      "172.16.0.1",
      "192.168.1.1",
      "169.254.169.254",
      "100.64.0.1",
      "0.0.0.0",
      "224.0.0.1",
      "255.255.255.255",
      "::1",
      "::",
      "fe80::1",
      "fc00::1",
      "ff02::1",
      "::ffff:127.0.0.1",
      "2001:db8::1",
    ])
      expect(blockedAddress(ip), ip).toBe(true);
    for (const ip of ["8.8.8.8", "1.1.1.1", "2606:4700:4700::1111"]) expect(blockedAddress(ip), ip).toBe(false);
  });

  it("allows a literal loopback only for the desktop tests", () => {
    expect(blockedAddress("127.0.0.1", "127.0.0.1", true)).toBe(false);
    // A name that resolves to loopback is still refused: DNS rebinding must not slip through.
    expect(blockedAddress("127.0.0.1", "evil.example", true)).toBe(true);
    expect(blockedAddress("10.0.0.1", "10.0.0.1", true)).toBe(true);
  });

  it("takes only http(s) URLs without credentials", () => {
    expect(captureUrl("https://example.com/a")?.hostname).toBe("example.com");
    expect(captureUrl("http://example.com")).not.toBeNull();
    expect(captureUrl("file:///etc/passwd")).toBeNull();
    expect(captureUrl("javascript:alert(1)")).toBeNull();
    expect(captureUrl("http://user:pass@example.com/")).toBeNull();
    expect(captureUrl("not a url")).toBeNull();
    expect(isLocalName("LOCALHOST")).toBe(true);
    expect(isLocalName("a.localhost")).toBe(true);
  });
});

describe("capture proxy and fetch", () => {
  it("proxies a checked request and refuses loopback when the test switch is off", async () => {
    const target = await localServer("through the proxy");
    const proxy = new CaptureNetwork(CAPTURE_LIMITS, true);
    const port = await proxy.listen();
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port, path: `http://127.0.0.1:${target}/hello`, method: "GET" },
          (res) => {
            const chunks: Buffer[] = [];
            res.on("data", (chunk) => chunks.push(chunk));
            res.on("end", () => resolve(Buffer.concat(chunks).toString()));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(body).toBe("through the proxy");
    } finally {
      proxy.close();
    }

    const blocked = new CaptureNetwork(CAPTURE_LIMITS, false);
    const blockedPort = await blocked.listen();
    try {
      const status = await new Promise<number>((resolve, reject) => {
        const req = http.request(
          { host: "127.0.0.1", port: blockedPort, path: `http://127.0.0.1:${target}/hello`, method: "GET" },
          (res) => {
            res.resume();
            res.on("end", () => resolve(res.statusCode ?? 0));
          },
        );
        req.on("error", reject);
        req.end();
      });
      expect(status).toBe(403);
    } finally {
      blocked.close();
    }
  });

  it("follows a redirect only when the new address is public, and counts requests", async () => {
    const target = await localServer();
    const network = new CaptureNetwork(CAPTURE_LIMITS, true);
    try {
      const ok = await network.fetch(new URL(`http://127.0.0.1:${target}/hello`));
      expect(ok.status).toBe(200);
      expect(ok.body.toString()).toBe("hello");
      await expect(network.fetch(new URL(`http://127.0.0.1:${target}/redirect`))).rejects.toBeInstanceOf(
        CaptureNetworkError,
      );
      expect(network.requests).toBeGreaterThan(1);
    } finally {
      network.close();
    }
  });
});
