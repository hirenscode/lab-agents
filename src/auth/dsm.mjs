import { SafetyError } from "../errors.mjs";
import { lanEndpoint } from "../brains/ollama.mjs";

const errors = {
  400: ["bad_credentials", "Incorrect DSM credentials"],
  401: ["account_disabled", "The DSM account is disabled"],
  402: ["account_denied", "The DSM account lacks permission"],
  403: ["otp_required", "Enter the DSM verification code"],
  404: ["otp_wrong", "Incorrect DSM verification code"],
  406: ["otp_enforced", "DSM requires two-step verification"],
  407: ["ip_blocked", "DSM blocked this client"],
};

function unavailable() {
  return new SafetyError("dsm_unavailable", "DSM is unavailable");
}

export function createDsmAuth(endpoint, { fetchImpl = globalThis.fetch, timeoutMs = 4000 } = {}) {
  const origin = endpoint ? lanEndpoint(endpoint) : null;
  async function send(path, init) {
    if (!origin) throw unavailable();
    try {
      const response = await fetchImpl(new URL(path, origin), {
        ...init, redirect: "error", signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) throw unavailable();
      return await response.json();
    } catch { throw unavailable(); }
  }
  async function discover() {
    const reply = await send("/webapi/query.cgi?api=SYNO.API.Info&version=1&method=query&query=SYNO.API.Auth");
    const api = reply?.data?.["SYNO.API.Auth"];
    if (reply?.success !== true || !api || !Number.isInteger(api.maxVersion) || api.maxVersion < 1 ||
        !/^[a-z0-9_-]+\.cgi$/i.test(api.path ?? "auth.cgi")) throw unavailable();
    return { path: api.path ?? "auth.cgi", version: api.maxVersion };
  }

  return {
    async reachable() {
      try { await discover(); return true; } catch { return false; }
    },
    async verify({ username, password, otp }) {
      const { path, version } = await discover();
      const body = new URLSearchParams({
        api: "SYNO.API.Auth", version, method: "login", account: username, passwd: password, session: "LabAgents", format: "sid",
      });
      if (otp) body.set("otp_code", otp);
      const reply = await send("/webapi/" + path, { method: "POST", body });
      if (reply?.success !== true) {
        const [code, message] = errors[reply?.error?.code] ?? ["bad_credentials", "DSM rejected the login"];
        throw new SafetyError(code, message);
      }
    },
  };
}
