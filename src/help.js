// Help is generated from the same zod schemas that validate the call, so it
// cannot drift from what the tool actually accepts.
import { describeFields, camelToKebab, toJsonSchema } from "./schema.js";
import { annotations, CONFIRM_ECHO } from "./safety.js";
import { VERBS } from "./verbs.js";
import { C } from "./render.js";

const TYPE_LABEL = {
  ZodString: "string", ZodNumber: "number", ZodBoolean: "flag",
  ZodArray: "json array", ZodObject: "json", ZodRecord: "json",
  ZodEnum: "enum", ZodUnion: "json",
};

function typeOf(field) {
  if (field.kind === "ZodEnum") {
    const values = field.zodType?._def?.values;
    if (Array.isArray(values)) return values.join("|");
  }
  return TYPE_LABEL[field.kind] || "string";
}

export function groups() {
  const map = new Map();
  for (const v of VERBS) {
    if (!map.has(v.path[0])) map.set(v.path[0], []);
    map.get(v.path[0]).push(v);
  }
  return map;
}

/** Levenshtein, for "did you mean" on typos. */
function distance(a, b) {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)]);
  for (let j = 0; j <= b.length; j++) d[0][j] = j;
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i][j] = Math.min(d[i - 1][j] + 1, d[i][j - 1] + 1, d[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
  }
  return d[a.length][b.length];
}

export function suggest(input, candidates, limit = 3) {
  if (!input) return [];
  return candidates
    .map((c) => ({ c, d: distance(input, c) }))
    .filter(({ c, d }) => d <= Math.max(2, Math.floor(c.length / 3)))
    .sort((a, b) => a.d - b.d)
    .slice(0, limit)
    .map(({ c }) => c);
}

/** Help for one command: what it does and every argument it takes. */
export function commandHelp({ commandPath, toolName, spec, positional = [] }) {
  const fields = describeFields(spec);
  const positionalSet = new Set(positional);
  const echoField = CONFIRM_ECHO[toolName]?.confirmField;
  const isEcho = (f) => f.name === echoField;
  const required = fields.filter((f) => f.required && !positionalSet.has(f.name) && !isEcho(f));
  const optional = fields.filter((f) => !f.required && !positionalSet.has(f.name) && !isEcho(f));
  const echo = fields.find(isEcho);
  const ann = annotations(toolName);

  const usage = [
    commandPath,
    ...positional.map((p) => `<${camelToKebab(p)}>`),
    ...required.map((f) => `${f.flag} <${typeOf(f)}>`),
    ann.destructiveHint ? "--yes" : "",
    optional.length ? "[options]" : "",
  ].filter(Boolean).join(" ");

  const out = [];
  out.push(`${C.bold(commandPath)} ${C.dim(`→ ${toolName}`)}`);
  if (spec?.description) out.push("", wrap(spec.description, 76));
  if (ann.destructiveHint) {
    out.push("", C.red("DESTRUCTIVE — requires --yes; without it the command exits 7."));
    if (echo) {
      out.push(C.dim(`  --yes also fills in ${echo.flag}, which AFFiNE requires as an echo of the target id.`));
    }
  } else if (ann.readOnlyHint) {
    out.push("", C.dim("Read-only. Safe under --profile read_only."));
  }
  out.push("", C.bold("USAGE"), `  affine ${usage}`);

  if (positional.length) {
    out.push("", C.bold("ARGUMENTS"));
    for (const name of positional) {
      const f = fields.find((x) => x.name === name);
      out.push(`  ${pad(`<${camelToKebab(name)}>`, 26)} ${f?.description || ""}`);
    }
  }
  if (required.length) {
    out.push("", C.bold("REQUIRED"));
    for (const f of required) out.push(fieldLine(f));
  }
  if (optional.length) {
    out.push("", C.bold("OPTIONS"));
    for (const f of optional) out.push(fieldLine(f));
  }
  out.push("", C.bold("SEE ALSO"), `  affine tools describe ${toolName} --json   ${C.dim("machine-readable schema")}`);
  return out.join("\n");
}

function fieldLine(f) {
  const head = `${f.flag} ${f.isBoolean ? "" : `<${typeOf(f)}>`}`.trim();
  const bits = [];
  if (f.description) bits.push(f.description);
  if (f.hasDefault && f.defaultValue !== undefined) bits.push(C.dim(`(default: ${JSON.stringify(f.defaultValue)})`));
  const body = wrap(bits.join(" "), 48).split("\n");
  return [`  ${pad(head, 26)} ${body[0] || ""}`, ...body.slice(1).map((l) => `  ${" ".repeat(26)} ${l}`)].join("\n");
}

/** Help for a group: which verbs live under it. */
export function groupHelp(name) {
  const verbs = groups().get(name);
  if (!verbs) return null;
  const lines = [`${C.bold(name)} commands`, ""];
  for (const v of verbs) {
    const cmd = v.path.join(" ") + (v.positional?.length ? " " + v.positional.map((p) => `<${camelToKebab(p)}>`).join(" ") : "");
    lines.push(`  ${pad(cmd, 40)} ${C.dim(v.summary)}`);
  }
  lines.push("", C.dim(`Run "affine ${name} <verb> --help" for a command's arguments.`));
  return lines.join("\n");
}

/** Structured help, for agents that ask with --help --json. */
export function helpAsJson({ commandPath, toolName, spec, positional = [] }) {
  const ann = annotations(toolName);
  return {
    command: commandPath,
    tool: toolName,
    description: spec?.description || "",
    destructive: ann.destructiveHint === true,
    readOnly: ann.readOnlyHint === true,
    positional: positional.map(camelToKebab),
    requiresYes: ann.destructiveHint === true,
    flags: describeFields(spec).map((f) => ({
      flag: f.flag, name: f.name, type: typeOf(f),
      required: f.required && f.name !== CONFIRM_ECHO[toolName]?.confirmField,
      autoFilledByYes: f.name === CONFIRM_ECHO[toolName]?.confirmField || undefined,
      default: f.hasDefault ? f.defaultValue : undefined,
      description: f.description,
    })),
    inputSchema: toJsonSchema(spec),
  };
}

const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, "");
const pad = (s, w) => s + " ".repeat(Math.max(0, w - stripAnsi(s).length));

function wrap(text, width) {
  const words = String(text).split(/\s+/).filter(Boolean);
  const lines = [];
  let line = "";
  for (const w of words) {
    if (line && (line.length + 1 + w.length) > width) { lines.push(line); line = w; }
    else line = line ? `${line} ${w}` : w;
  }
  if (line) lines.push(line);
  return lines.join("\n");
}
