// Sign in once, keep the session. Every CLI invocation is a new process, so
// email/password auth signs in per command and AFFiNE rate-limits that (429
// after roughly a dozen rapid calls). A stored cookie removes the round trip.
import { writeCredentials, clearCredentials, credentialsPath } from "./credentials.js";

export class LoginError extends Error {
  constructor(message, code = "login_failed") {
    super(message);
    this.name = "LoginError";
    this.code = code;
  }
}

/** Parse Set-Cookie headers into a request-ready cookie string plus expiry. */
// Attribute names that must never be mistaken for the cookie pair; `Path=/`
// contains an "=" and would otherwise parse as a cookie called "Path".
const COOKIE_ATTRIBUTES = new Set([
  "path", "domain", "expires", "max-age", "secure", "httponly", "samesite", "partitioned", "priority",
]);

export function parseSetCookies(setCookies) {
  const pairs = [];
  let earliest = null;
  for (const raw of setCookies) {
    const [pair, ...attrs] = raw.split(";");
    if (!pair?.includes("=")) continue;
    const name = pair.slice(0, pair.indexOf("=")).trim().toLowerCase();
    if (!name || COOKIE_ATTRIBUTES.has(name)) continue;
    pairs.push(pair.trim());
    for (const attr of attrs) {
      const [k, v] = attr.split("=").map((s) => s?.trim());
      const key = k?.toLowerCase();
      let when = null;
      if (key === "max-age" && v && Number.isFinite(Number(v))) {
        when = Date.now() + Number(v) * 1000;
      } else if (key === "expires" && v && !Number.isNaN(Date.parse(v))) {
        when = Date.parse(v);
      }
      // Session validity is bounded by the soonest-expiring cookie.
      if (when && (earliest === null || when < earliest)) earliest = when;
    }
  }
  if (!pairs.length) return null;
  return {
    cookie: pairs.join("; "),
    expiresAt: earliest ? new Date(earliest).toISOString() : null,
  };
}

export async function signIn({ baseUrl, email, password }) {
  const url = new URL("/api/auth/sign-in", baseUrl);
  let response;
  try {
    response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  } catch (error) {
    throw new LoginError(`Could not reach ${url.origin}: ${error.message}`, "network_error");
  }

  if (response.status === 429) {
    throw new LoginError(
      "AFFiNE rate-limited the sign-in. Wait a moment and retry; this is exactly " +
      "what storing a session avoids.",
      "rate_limited"
    );
  }
  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new LoginError(
      `Sign-in failed (HTTP ${response.status}). ${body.slice(0, 200)}`,
      response.status === 401 || response.status === 403 ? "invalid_credentials" : "login_failed"
    );
  }

  const parsed = parseSetCookies(response.headers.getSetCookie?.() ?? []);
  if (!parsed) throw new LoginError("Sign-in succeeded but returned no session cookie.");
  return parsed;
}

export async function login({ baseUrl, email, password }) {
  const { cookie, expiresAt } = await signIn({ baseUrl, email, password });
  const file = writeCredentials({
    baseUrl: String(baseUrl).replace(/\/+$/, ""),
    email,
    cookie,
    expiresAt,
    savedAt: new Date().toISOString(),
  });
  return { file, expiresAt, email };
}

export function logout() {
  return { cleared: clearCredentials(), file: credentialsPath() };
}
