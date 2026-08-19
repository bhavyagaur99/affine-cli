// One command surface, two renderers. Selection is by TTY unless overridden,
// so agents get JSON with no flag and humans get tables with no flag.

const isTTY = () => Boolean(process.stdout.isTTY);

export function pickRenderer({ json, human }) {
  if (json) return "json";
  if (human) return "human";
  return isTTY() ? "human" : "json";
}

const C = {
  dim: (s) => (isTTY() ? `\x1b[2m${s}\x1b[0m` : s),
  bold: (s) => (isTTY() ? `\x1b[1m${s}\x1b[0m` : s),
  red: (s) => (isTTY() ? `\x1b[31m${s}\x1b[0m` : s),
  green: (s) => (isTTY() ? `\x1b[32m${s}\x1b[0m` : s),
};
export { C };

export function emit(renderer, payload) {
  if (renderer === "json") {
    process.stdout.write(JSON.stringify(payload) + "\n");
    return;
  }
  if (!payload.ok) {
    process.stderr.write(`${C.red("error")} ${payload.error}\n`);
    if (payload.code) process.stderr.write(C.dim(`  code: ${payload.code}\n`));
    return;
  }
  process.stdout.write(humanize(payload.data) + "\n");
}

function humanize(data) {
  if (data === null || data === undefined) return C.dim("(no output)");
  if (typeof data === "string") return data;
  if (Array.isArray(data)) return data.length ? table(data) : C.dim("(empty)");
  if (typeof data === "object") {
    const items = pickList(data);
    if (items) return items.length ? table(items) : C.dim("(empty)");
    return Object.entries(data)
      .map(([k, v]) => `${C.bold(k)}: ${scalar(v)}`)
      .join("\n");
  }
  return String(data);
}

/** Find the one array field that is clearly the payload's list. */
function pickList(obj) {
  const arrays = Object.entries(obj).filter(([, v]) => Array.isArray(v));
  if (arrays.length !== 1) return null;
  const [, list] = arrays[0];
  if (!list.every((x) => x && typeof x === "object" && !Array.isArray(x))) return null;
  return flattenRelay(list);
}

/** Relay connections nest the payload under `node`; show the node itself. */
function flattenRelay(list) {
  const isEdge = (x) => {
    const keys = Object.keys(x);
    return keys.includes("node") && x.node && typeof x.node === "object"
      && keys.every((k) => k === "node" || k === "cursor");
  };
  return list.every(isEdge) ? list.map((x) => x.node) : list;
}

function scalar(v) {
  if (v === null || v === undefined) return C.dim("—");
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function table(rows) {
  const cols = [...new Set(rows.flatMap((r) => Object.keys(r)))]
    .filter((c) => rows.some((r) => r[c] !== null && r[c] !== undefined && r[c] !== ""))
    .slice(0, 6);
  const cells = rows.map((r) => cols.map((c) => truncate(scalarPlain(r[c]))));
  const widths = cols.map((c, i) =>
    Math.max(c.length, ...cells.map((row) => stripAnsi(row[i]).length)));
  const line = (vals) => vals.map((v, i) => pad(v, widths[i])).join("  ").trimEnd();
  return [C.bold(line(cols)), C.dim(line(widths.map((w) => "─".repeat(w)))), ...cells.map(line)].join("\n");
}

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, w) => s + " ".repeat(Math.max(0, w - stripAnsi(s).length));
const truncate = (s, n = 44) => (s.length > n ? s.slice(0, n - 1) + "…" : s);
function scalarPlain(v) {
  if (v === null || v === undefined) return "—";
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}
