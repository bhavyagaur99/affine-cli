// Stored session state. Only a session cookie ever lands here — never a
// password. The file is 0600 inside a 0700 directory.
import { mkdirSync, readFileSync, writeFileSync, rmSync, existsSync, chmodSync } from "node:fs";
import path from "node:path";
import os from "node:os";

export function configDir() {
  if (process.env.AFFINE_CLI_HOME) return process.env.AFFINE_CLI_HOME;
  const xdg = process.env.XDG_CONFIG_HOME;
  return path.join(xdg || path.join(os.homedir(), ".config"), "affine-cli");
}

export function credentialsPath() {
  return path.join(configDir(), "credentials.json");
}

export function readCredentials() {
  const file = credentialsPath();
  if (!existsSync(file)) return null;
  try {
    const data = JSON.parse(readFileSync(file, "utf8"));
    return data && typeof data === "object" ? data : null;
  } catch {
    return null;
  }
}

export function writeCredentials(record) {
  const dir = configDir();
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  try { chmodSync(dir, 0o700); } catch { /* pre-existing dir may be owned differently */ }
  const file = credentialsPath();
  writeFileSync(file, JSON.stringify(record, null, 2) + "\n", { mode: 0o600 });
  chmodSync(file, 0o600);
  return file;
}

export function clearCredentials() {
  const file = credentialsPath();
  if (!existsSync(file)) return false;
  rmSync(file);
  return true;
}

/** A stored session is usable only for the base URL it was issued by. */
export function storedCookieFor(baseUrl) {
  const record = readCredentials();
  if (!record?.cookie) return null;
  if (record.baseUrl && baseUrl && normalize(record.baseUrl) !== normalize(baseUrl)) return null;
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) return null;
  return record.cookie;
}

export function storedSessionStatus(baseUrl) {
  const record = readCredentials();
  if (!record?.cookie) return { state: "absent" };
  if (record.baseUrl && baseUrl && normalize(record.baseUrl) !== normalize(baseUrl)) {
    return { state: "other_host", storedFor: record.baseUrl };
  }
  if (record.expiresAt && Date.parse(record.expiresAt) <= Date.now()) {
    return { state: "expired", expiresAt: record.expiresAt };
  }
  return { state: "valid", email: record.email || null, expiresAt: record.expiresAt || null };
}

const normalize = (u) => String(u).replace(/\/+$/, "").toLowerCase();
