import { createHash, randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { SafetyError } from "../errors.mjs";

const derive = promisify(scrypt);
const digest = (value) => createHash("sha256").update(value).digest("base64url");
const cookieName = "lab_agents";
const lifetime = 12 * 60 * 60;

function denied(code, message) {
  throw new SafetyError(code, message);
}

function same(a, b) {
  return a.length === b.length && timingSafeEqual(a, b);
}

export async function saveLocalAdmin(database, username, password) {
  if (!/^[A-Za-z0-9._-]{1,60}$/.test(username ?? "") || typeof password !== "string" ||
      password.length < 12 || password.length > 1024) {
    denied("invalid_login", "Use a local username and a password of at least 12 characters");
  }
  const salt = randomBytes(16).toString("hex");
  const hash = (await derive(password, salt, 64)).toString("hex");
  database.exec("BEGIN IMMEDIATE");
  try {
    database.prepare("INSERT OR IGNORE INTO users(dsm_username,role,created_at) VALUES(?,'admin',?)")
      .run("local:" + username, new Date().toISOString());
    const { id } = database.prepare("SELECT id FROM users WHERE dsm_username=?").get("local:" + username);
    database.prepare(`
      INSERT INTO local_admins(username,user_id,salt,password_hash) VALUES(?,?,?,?)
      ON CONFLICT(username) DO UPDATE SET salt=excluded.salt,password_hash=excluded.password_hash
    `).run(username, id, salt, hash);
    database.prepare("DELETE FROM sessions WHERE user_id=?").run(id);
    database.exec("COMMIT");
  } catch (error) { database.exec("ROLLBACK"); throw error; }
}

export function createSessions(database, { dsm, adminUsers = [], secure = false, now = () => new Date() } = {}) {
  const attempts = new Map();
  const clock = () => Math.floor(now().getTime() / 1000);
  const csrf = (token) => digest("csrf:" + token);
  const tokenFrom = (request) => request.headers.cookie?.match(/(?:^|;\s*)lab_agents=([A-Za-z0-9_-]{43})(?:;|$)/)?.[1];
  const cookie = (request, token, maxAge) => `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${maxAge}${secure || request.protocol === "https" ? "; Secure" : ""}`;

  function rateLimit(ip) {
    const current = clock();
    for (const [key, attempt] of attempts) if (attempt.until <= current) attempts.delete(key);
    if (attempts.size >= 2000 && !attempts.has(ip)) denied("rate_limited", "Try signing in again in a minute");
    const attempt = attempts.get(ip) ?? { until: current + 60, count: 0 };
    if (attempt.count >= 5) denied("rate_limited", "Try signing in again in a minute");
    attempt.count++;
    attempts.set(ip, attempt);
  }

  function identity(id) {
    const row = database.prepare("SELECT id,dsm_username,role FROM users WHERE id=?").get(id);
    return { id: row.id, username: row.dsm_username.replace(/^local:/, ""), role: row.role };
  }

  function session(request) {
    const token = tokenFrom(request);
    const row = token && database.prepare("SELECT user_id FROM sessions WHERE token_hash=? AND expires_at>?")
      .get(digest(token), clock());
    if (!row) denied("unauthorized", "Sign in to Lab Agents");
    return { user: identity(row.user_id), csrfToken: csrf(token), token };
  }

  return {
    session,
    async login(request, reply) {
      rateLimit(request.ip);
      const { username, password, otp, provider = "dsm" } = request.body ?? {};
      if (typeof username !== "string" || !username.trim() || username.length > 128 || /[:\x00-\x1f]/.test(username)
          || typeof password !== "string" || !password.length || password.length > 1024 ||
          (otp !== undefined && (typeof otp !== "string" || !/^\d{4,12}$/.test(otp))) || !["dsm", "local"].includes(provider)) {
        denied("invalid_login", "Enter valid sign-in details");
      }
      let id;
      if (provider === "local") {
        if (await dsm.reachable()) denied("local_denied", "DSM is available. Sign in with your DSM account.");
        const admin = database.prepare("SELECT * FROM local_admins WHERE username=?").get(username);
        const candidate = await derive(password, admin?.salt ?? "0000000000000000", 64);
        if (!admin || !same(Buffer.from(admin.password_hash, "hex"), candidate)) denied("bad_credentials", "Incorrect local credentials");
        id = admin.user_id;
      } else {
        await dsm.verify({ username, password, otp });
        const role = adminUsers.includes(username) ? "admin" : "user";
        id = database.prepare(`
          INSERT INTO users(dsm_username,role,created_at) VALUES(?,?,?)
          ON CONFLICT(dsm_username) DO UPDATE SET role=excluded.role RETURNING id
        `).get(username, role, now().toISOString()).id;
      }
      attempts.delete(request.ip);
      const token = randomBytes(32).toString("base64url");
      database.prepare("DELETE FROM sessions WHERE expires_at<=?").run(clock());
      const previous = tokenFrom(request);
      if (previous) database.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(previous));
      database.prepare("INSERT INTO sessions(token_hash,user_id,expires_at) VALUES(?,?,?)")
        .run(digest(token), id, clock() + lifetime);
      reply.header("set-cookie", cookie(request, token, lifetime)).header("cache-control", "no-store");
      return { user: identity(id), csrfToken: csrf(token) };
    },
    verifyCsrf(request, current) {
      const supplied = request.headers["x-csrf-token"];
      if (typeof supplied !== "string" || !same(Buffer.from(supplied), Buffer.from(current.csrfToken))) {
        denied("csrf_denied", "Invalid request token");
      }
    },
    logout(request, reply, current) {
      database.prepare("DELETE FROM sessions WHERE token_hash=?").run(digest(current.token));
      reply.header("set-cookie", cookie(request, "", 0)).code(204).send();
    },
  };
}
