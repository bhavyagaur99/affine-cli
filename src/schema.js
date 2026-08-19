// Derives CLI flags, help text, and argument coercion from each tool's zod
// inputSchema — without importing zod. Only structural fields are read, so a
// zod major-version bump upstream cannot break argument parsing outright.

function unwrap(zodType) {
  let node = zodType;
  let optional = false;
  let hasDefault = false;
  let defaultValue;
  const guard = new Set();

  while (node?._def && !guard.has(node)) {
    guard.add(node);
    const kind = node._def.typeName;
    if (kind === "ZodOptional" || kind === "ZodNullable") {
      optional = true;
      node = node._def.innerType;
    } else if (kind === "ZodDefault") {
      optional = true;
      hasDefault = true;
      try { defaultValue = node._def.defaultValue(); } catch { /* ignore */ }
      node = node._def.innerType;
    } else if (kind === "ZodEffects") {
      node = node._def.schema;
    } else {
      break;
    }
  }
  return { node, kind: node?._def?.typeName, optional, hasDefault, defaultValue };
}

export function camelToKebab(name) {
  return name.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase();
}

export function kebabToCamel(name) {
  return name.replace(/-([a-z0-9])/g, (_, c) => c.toUpperCase());
}

/** Describe one tool's inputSchema as CLI-facing field metadata. */
export function describeFields(spec) {
  const fields = [];
  for (const [name, zodType] of Object.entries(spec?.inputSchema || {})) {
    const { kind, optional, hasDefault, defaultValue } = unwrap(zodType);
    fields.push({
      name,
      flag: `--${camelToKebab(name)}`,
      kind: kind || "ZodUnknown",
      required: !optional,
      hasDefault,
      defaultValue,
      isBoolean: kind === "ZodBoolean",
      description: zodType?.description || zodType?._def?.description || "",
      zodType,
    });
  }
  return fields;
}

/** Coerce a raw string from argv into the shape the zod field expects. */
export function coerce(field, raw) {
  switch (field.kind) {
    case "ZodBoolean":
      if (raw === undefined || raw === "") return true;
      if (["true", "1", "yes"].includes(String(raw).toLowerCase())) return true;
      if (["false", "0", "no"].includes(String(raw).toLowerCase())) return false;
      throw new UsageError(`${field.flag} expects a boolean, got ${JSON.stringify(raw)}`);
    case "ZodNumber": {
      const n = Number(raw);
      if (!Number.isFinite(n)) throw new UsageError(`${field.flag} expects a number, got ${JSON.stringify(raw)}`);
      return n;
    }
    case "ZodArray":
    case "ZodObject":
    case "ZodRecord":
    case "ZodUnion":
      try { return JSON.parse(raw); }
      catch { throw new UsageError(`${field.flag} expects JSON, got ${JSON.stringify(raw)}`); }
    default:
      return raw;
  }
}

/** Validate assembled args against the per-field zod schemas. */
export function validate(spec, args) {
  const errors = [];
  const out = {};
  for (const [name, zodType] of Object.entries(spec?.inputSchema || {})) {
    const present = Object.prototype.hasOwnProperty.call(args, name);
    if (!present) {
      const { optional } = unwrap(zodType);
      if (!optional) errors.push(`missing required --${camelToKebab(name)}`);
      continue;
    }
    const result = zodType.safeParse ? zodType.safeParse(args[name]) : { success: true, data: args[name] };
    if (!result.success) {
      const detail = result.error?.issues?.map((i) => i.message).join("; ") || "invalid value";
      errors.push(`--${camelToKebab(name)}: ${detail}`);
    } else {
      out[name] = result.data;
    }
  }
  for (const key of Object.keys(args)) {
    if (!Object.prototype.hasOwnProperty.call(spec?.inputSchema || {}, key)) {
      errors.push(`unknown argument "${key}"`);
    }
  }
  if (errors.length) throw new UsageError(errors.join("\n"));
  return out;
}

/** JSON Schema rendering for `tools describe --json`, for agent consumption. */
export function toJsonSchema(spec) {
  const properties = {};
  const required = [];
  for (const f of describeFields(spec)) {
    const map = {
      ZodString: "string", ZodNumber: "number", ZodBoolean: "boolean",
      ZodArray: "array", ZodObject: "object", ZodRecord: "object",
    };
    properties[f.name] = {
      type: map[f.kind] || "string",
      ...(f.description ? { description: f.description } : {}),
      ...(f.hasDefault ? { default: f.defaultValue } : {}),
    };
    if (f.required) required.push(f.name);
  }
  return { type: "object", properties, ...(required.length ? { required } : {}) };
}

export class UsageError extends Error {
  constructor(message) { super(message); this.name = "UsageError"; this.code = "usage_error"; }
}
