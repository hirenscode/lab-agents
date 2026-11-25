import { lookup as systemLookup } from "node:dns/promises";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";
import { BlockList, isIP } from "node:net";
import { domainToASCII } from "node:url";
import { SafetyError } from "../errors.mjs";

const nonPublic = new BlockList();
const ipv4Ranges = [
  ["0.0.0.0", 8], ["10.0.0.0", 8], ["100.64.0.0", 10], ["127.0.0.0", 8],
  ["169.254.0.0", 16], ["172.16.0.0", 12], ["192.0.0.0", 24], ["192.0.2.0", 24],
  ["192.88.99.0", 24], ["192.168.0.0", 16], ["198.18.0.0", 15], ["198.51.100.0", 24],
  ["203.0.113.0", 24], ["224.0.0.0", 4], ["240.0.0.0", 4],
];
for (const [address, prefix] of ipv4Ranges) nonPublic.addSubnet(address, prefix);
for (const [address, prefix] of [
  ["2001::", 23], ["2001:db8::", 32], ["2002::", 16], ["3fff::", 20],
]) {
  nonPublic.addSubnet(address, prefix, "ipv6");
}

const globalIPv6 = new BlockList();
globalIPv6.addSubnet("2000::", 3, "ipv6");

const redirects = new Set([301, 302, 303, 307, 308]);
const httpProtocols = new Set(["http:", "https:"]);

function deny(message) {
  return new SafetyError("url_denied", message);
}

function domain(value) {
  if (typeof value !== "string" || /[/\\#?:@%\s]/.test(value)) {
    throw deny("Expected a hostname");
  }

  const hostname = domainToASCII(value).replace(/\.$/, "");
  if (hostname.length > 253 || isIP(hostname)
      || !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label))) {
    throw deny("Expected a DNS hostname");
  }
  return hostname.toLowerCase();
}

function parseUrl(value, allowed, previous) {
  if (typeof value !== "string" || value.trim() === "") throw deny("Expected a URL");

  let target;
  try {
    target = new URL(value, previous);
  } catch {
    throw deny("Invalid URL");
  }

  if (!httpProtocols.has(target.protocol) || target.username || target.password) {
    throw deny("Only HTTP and HTTPS URLs without credentials are allowed");
  }
  const hostname = domain(target.hostname);
  if (previous && hostname !== previous.hostname) throw deny("Cross-domain redirect denied");
  if (!allowed.has(hostname)) throw deny("Hostname is outside the tool's allow-list");
  target.hostname = hostname;
  target.hash = "";
  return target;
}

function isPublic({ address, family }) {
  if (typeof address !== "string" || isIP(address) !== family || address.includes("%")) return false;
  if (family === 4) return !nonPublic.check(address);
  return family === 6 && globalIPv6.check(address, "ipv6") && !nonPublic.check(address, "ipv6");
}

async function resolvePublic(hostname, lookup, signal) {
  signal.throwIfAborted();
  let onAbort;
  const aborted = new Promise((_resolve, reject) => {
    onAbort = () => reject(signal.reason);
    signal.addEventListener("abort", onAbort, { once: true });
  });
  try {
    // The trailing dot prevents a system DNS search suffix from changing the host.
    const answers = await Promise.race([lookup(hostname + ".", { all: true }), aborted]);
    signal.throwIfAborted();
    if (!Array.isArray(answers) || answers.length === 0 || answers.some((answer) => !answer || !isPublic(answer))) {
      throw deny("Hostname did not resolve exclusively to public addresses");
    }
    return answers.map(({ address, family }) => ({ address, family }));
  } finally {
    signal.removeEventListener("abort", onAbort);
  }
}

function requestResponse(url, addresses, signal, request) {
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const req = request(url, {
      method: "GET",
      agent: false,
      autoSelectFamily: true,
      rejectUnauthorized: true,
      signal,
      headers: { "accept-encoding": "identity" },
      // Keep the hostname for HTTP Host and TLS. Only vetted addresses reach the socket.
      lookup(_hostname, options, callback) {
        if (options.all) {
          callback(null, addresses);
        } else {
          callback(null, addresses[0].address, addresses[0].family);
        }
      },
    }, resolve);
    req.once("error", (error) => reject(signal.aborted ? signal.reason : error));
    req.end();
  });
}

async function readBody(response, maxBytes, signal) {
  if (Number(response.headers["content-length"]) > maxBytes) {
    throw new SafetyError("response_too_large", "Response exceeds the byte limit");
  }

  const chunks = [];
  let bytes = 0;
  for await (const chunk of response) {
    signal.throwIfAborted();
    bytes += chunk.length;
    if (bytes > maxBytes) throw new SafetyError("response_too_large", "Response exceeds the byte limit");
    chunks.push(chunk);
  }
  signal.throwIfAborted();
  return Buffer.concat(chunks, bytes);
}

export function createUrlGuard({
  lookup = systemLookup,
  request = (url, options, callback) => (url.protocol === "https:" ? httpsRequest : httpRequest)(url, options, callback),
  timeoutMs = 10_000,
  maxBytes = 256 * 1024,
  maxRedirects = 3,
} = {}) {
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0 || timeoutMs > 2 ** 31 - 1
      || !Number.isSafeInteger(maxBytes) || maxBytes <= 0
      || !Number.isSafeInteger(maxRedirects) || maxRedirects < 0) {
    throw deny("Invalid web request limits");
  }

  return async function fetchAllowed(input, { allowedDomains, signal: callerSignal } = {}) {
    if (!Array.isArray(allowedDomains) || allowedDomains.length === 0) throw deny("A hostname allow-list is required");
    const allowed = new Set(allowedDomains.map(domain));
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = callerSignal ? AbortSignal.any([callerSignal, timeout]) : timeout;
    let url = parseUrl(input, allowed);

    for (let followed = 0; ; followed++) {
      const addresses = await resolvePublic(url.hostname, lookup, signal);
      const response = await requestResponse(url, addresses, signal, request);
      try {
        signal.throwIfAborted();
        if (!redirects.has(response.statusCode)) {
          const body = await readBody(response, maxBytes, signal);
          return { url: url.href, statusCode: response.statusCode, headers: response.headers, body };
        }
        if (followed >= maxRedirects) throw deny("Too many redirects");
        url = parseUrl(response.headers.location, allowed, url);
      } catch (error) {
        signal.throwIfAborted();
        throw error;
      } finally {
        response.destroy();
      }
    }
  };
}
