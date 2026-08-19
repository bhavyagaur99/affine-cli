// Maps upstream error codes onto stable process exit codes.
export const EXIT = {
  OK: 0,
  GENERIC: 1,
  USAGE: 2,
  AUTH: 3,
  NOT_FOUND: 4,
  PERMISSION: 5,
  RETRYABLE: 6,
  NEEDS_CONFIRM: 7,
};

export function exitCodeFor({ code = "", error = "", retryable = false } = {}) {
  const haystack = `${code} ${error}`.toLowerCase();
  if (code === "usage_error") return EXIT.USAGE;
  if (code === "needs_confirmation") return EXIT.NEEDS_CONFIRM;
  if (code === "indexer_disabled") return EXIT.PERMISSION;
  if (/unauthor|not authenticated|sign in|invalid credential|token expired/.test(haystack)) return EXIT.AUTH;
  if (/permission|forbidden|access denied|not allowed/.test(haystack)) return EXIT.PERMISSION;
  if (/not ?found|no such|does not exist/.test(haystack)) return EXIT.NOT_FOUND;
  if (retryable || /timeout|econnrefused|enotfound|socket hang up|network/.test(haystack)) return EXIT.RETRYABLE;
  return EXIT.GENERIC;
}
