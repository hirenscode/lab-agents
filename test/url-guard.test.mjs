import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { PassThrough, Readable } from "node:stream";
import { test } from "node:test";
import { createUrlGuard } from "../src/safety/url-guard.mjs";

const scope = { allowedDomains: ["example.com"] };
const denied = { code: "url_denied" };
const publicIPv4 = { address: "93.184.216.34", family: 4 };
const publicIPv6 = { address: "2606:4700::1111", family: 6 };

function fixture(routes = [{}], overrides = {}) {
  const requests = [];
  const lookups = [];
  const fetch = createUrlGuard({
    lookup(hostname, options) {
      lookups.push({ hostname, options });
      return [publicIPv4, publicIPv6];
    },
    request(url, options, onResponse) {
      const route = routes[requests.length];
      const req = new EventEmitter();
      req.end = () => {
        const request = { url: url.href, options };
        options.lookup(url.hostname, { all: true }, (error, pinned) => {
          assert.ifError(error);
          request.pinned = pinned;
        });
        requests.push(request);
        const response = route.stream ?? Readable.from((route.chunks ?? ["ok"]).map((chunk) => Buffer.from(chunk)));
        response.statusCode = route.statusCode ?? 200;
        response.headers = route.headers ?? {};
        response.once("close", () => options.signal.removeEventListener("abort", onAbort));
        const onAbort = () => response.destroy();
        options.signal.addEventListener("abort", onAbort, { once: true });
        onResponse(response);
        route.afterHeaders?.();
      };
      return req;
    },
    ...overrides,
  });
  return { fetch, requests, lookups };
}

test("URL guard pins vetted A and AAAA answers and preserves the HTTPS hostname", async () => {
  const { fetch, requests, lookups } = fixture();
  const response = await fetch("https://EXAMPLE.com./page", scope);
  assert.equal(response.body.toString(), "ok");
  assert.equal(response.statusCode, 200);
  assert.equal(requests[0].url, "https://example.com/page");
  assert.equal(requests[0].options.agent, false);
  assert.equal(requests[0].options.rejectUnauthorized, true);
  assert.deepEqual(requests[0].pinned, [publicIPv4, publicIPv6]);
  assert.deepEqual(lookups, [{ hostname: "example.com.", options: { all: true } }]);
});

test("URL guard denies loopback, LAN literals, lookalike hosts, credentials, and non-HTTP URLs before DNS", async () => {
  const { fetch, requests, lookups } = fixture();
  for (const url of [
    "http://127.0.0.1", "http://192.168.1.10", "http://[::1]", "http://2130706433",
    "https://example.com.other.test/", "https://user:pass@example.com/",
    "https://example.com@other.test/", "file:///tmp/file", "https://sub.example.com/",
  ]) {
    await assert.rejects(fetch(url, scope), denied);
  }
  await assert.rejects(fetch("https://redfin.com.evil.com", { allowedDomains: ["redfin.com"] }), denied);
  await assert.rejects(fetch("https://example.com", { allowedDomains: [] }), denied);
  await assert.rejects(fetch("https://example.com", { allowedDomains: ["https://example.com/path"] }), denied);
  assert.deepEqual(lookups, []);
  assert.deepEqual(requests, []);
});

test("URL guard refuses any DNS result containing a private, local, or translated address", async () => {
  for (const [address, family] of [
    ["127.0.0.1", 4], ["192.168.1.10", 4], ["169.254.20.30", 4], ["100.64.0.1", 4], ["224.0.0.1", 4],
    ["::1", 6], ["fc00::1", 6], ["fe80::1", 6], ["::ffff:192.168.1.10", 6], ["64:ff9b::c0a8:10a", 6],
    ["2002:c0a8:10a::1", 6], ["not an address", 4],
  ]) {
    const { fetch, requests } = fixture([], { lookup: async () => [publicIPv4, { address, family }] });
    await assert.rejects(fetch("https://example.com", scope), denied, address);
    assert.deepEqual(requests, []);
  }
});

test("URL guard refuses cross-domain redirects even when both domains are allowed", async () => {
  const { fetch, requests, lookups } = fixture([{ statusCode: 302, headers: { location: "https://other.test/" } }]);
  await assert.rejects(fetch("https://example.com", { allowedDomains: ["example.com", "other.test"] }), denied);
  assert.equal(requests.length, 1);
  assert.equal(lookups.length, 1);
});

test("URL guard rechecks every same-host redirect and refuses a DNS change to a private address", async () => {
  let count = 0;
  const { fetch, requests } = fixture([{ statusCode: 301, headers: { location: "/second" } }], {
    lookup: async () => (++count === 1 ? [publicIPv4] : [{ address: "192.168.1.10", family: 4 }]),
  });
  await assert.rejects(fetch("https://example.com/first", scope), denied);
  assert.equal(count, 2);
  assert.equal(requests.length, 1);
});

test("URL guard follows a permitted redirect and bounds the hop count", async () => {
  const redirect = { statusCode: 307, headers: { location: "/next" } };
  const success = fixture([redirect, {}], { maxRedirects: 1 });
  assert.equal((await success.fetch("https://example.com/start", scope)).url, "https://example.com/next");
  const loop = fixture([redirect, redirect], { maxRedirects: 1 });
  await assert.rejects(loop.fetch("https://example.com/start", scope), denied);
  assert.equal(loop.requests.length, 2);
});

test("URL guard caps both declared and streamed response bytes", async () => {
  for (const route of [{ headers: { "content-length": "5" } }, { chunks: ["123", "45"] }]) {
    const { fetch } = fixture([route], { maxBytes: 4 });
    await assert.rejects(fetch("https://example.com/", scope), { code: "response_too_large" });
  }
  const exact = fixture([{ chunks: ["12", "34"] }], { maxBytes: 4 });
  assert.equal((await exact.fetch("https://example.com/", scope)).body.toString(), "1234");
});

test("URL guard aborts during DNS and while reading an open body", async () => {
  const dnsAbort = new AbortController();
  const dns = fixture([], {
    lookup: async () => {
      dnsAbort.abort(new Error("DNS cancelled"));
      return new Promise(() => {});
    },
  });
  await assert.rejects(dns.fetch("https://example.com", { ...scope, signal: dnsAbort.signal }), /DNS cancelled/);
  assert.equal(dns.requests.length, 0);

  const bodyAbort = new AbortController();
  const stream = new PassThrough();
  const body = fixture([{ stream, afterHeaders: () => queueMicrotask(() => bodyAbort.abort(new Error("Body cancelled"))) }]);
  await assert.rejects(body.fetch("https://example.com", { ...scope, signal: bodyAbort.signal }), /Body cancelled/);
  assert.ok(stream.destroyed);
});

test("URL guard applies the deadline even when DNS has not answered", async (t) => {
  const keepAlive = setTimeout(() => {}, 1_000);
  t.after(() => clearTimeout(keepAlive));
  const { fetch, requests } = fixture([], { timeoutMs: 10, lookup: () => new Promise(() => {}) });
  await assert.rejects(fetch("https://example.com", scope), { name: "TimeoutError" });
  assert.deepEqual(requests, []);
});
