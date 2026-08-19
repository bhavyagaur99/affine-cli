import { buildRegistry, assertManifestParity } from "./registry.js";
import { createClient } from "./client.js";
import { describeFields, coerce, validate, toJsonSchema, kebabToCamel, camelToKebab, UsageError } from "./schema.js";
import { pickRenderer, emit, C } from "./render.js";
import { EXIT, exitCodeFor } from "./exit.js";
import { gate, annotations, profileFilter, ConfirmationRequired } from "./safety.js";
import { VERBS, findVerb } from "./verbs.js";
import { commandHelp, groupHelp, helpAsJson, groups, suggest } from "./help.js";

const VERSION = "0.1.0";

function parseGlobals(argv) {
  const globals = { json: false, human: false, yes: false, workspace: undefined, profile: undefined, help: false };
  const rest = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--json") globals.json = true;
    else if (a === "--human") globals.human = true;
    else if (a === "--yes" || a === "-y") globals.yes = true;
    else if (a === "--workspace" || a === "-w") globals.workspace = argv[++i];
    else if (a?.startsWith("--workspace=")) globals.workspace = a.slice(12);
    else if (a === "--profile") globals.profile = argv[++i];
    else if (a?.startsWith("--profile=")) globals.profile = a.slice(10);
    else if (a === "--help" || a === "-h") globals.help = true;
    else rest.push(a);
  }
  return { globals, rest };
}

/** Turn remaining argv into a tool argument object, using the zod fields. */
function parseToolArgs(spec, argv, positionalNames = []) {
  const fields = describeFields(spec);
  const byFlag = new Map(fields.map((f) => [f.name, f]));
  const args = {};
  const positionals = [];

  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (token === "--args") {
      const raw = argv[++i];
      let parsed;
      try { parsed = JSON.parse(raw); }
      catch { throw new UsageError(`--args expects JSON, got ${JSON.stringify(raw)}`); }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new UsageError("--args must be a JSON object");
      }
      Object.assign(args, parsed);
      continue;
    }
    if (token === "--arg") {
      const raw = argv[++i] ?? "";
      const eq = raw.indexOf("=");
      if (eq < 1) throw new UsageError(`--arg expects key=value, got ${JSON.stringify(raw)}`);
      const key = kebabToCamel(raw.slice(0, eq));
      const field = byFlag.get(key);
      args[key] = field ? coerce(field, raw.slice(eq + 1)) : raw.slice(eq + 1);
      continue;
    }
    if (token?.startsWith("--")) {
      const eq = token.indexOf("=");
      const name = kebabToCamel(eq > 0 ? token.slice(2, eq) : token.slice(2));
      const field = byFlag.get(name);
      if (!field) throw new UsageError(`unknown flag ${token}`);
      if (eq > 0) args[name] = coerce(field, token.slice(eq + 1));
      else if (field.isBoolean) args[name] = true;
      else args[name] = coerce(field, argv[++i]);
      continue;
    }
    positionals.push(token);
  }

  positionalNames.forEach((name, idx) => {
    if (positionals[idx] !== undefined && args[name] === undefined) {
      const field = byFlag.get(name);
      args[name] = field ? coerce(field, positionals[idx]) : positionals[idx];
    }
  });

  for (const f of fields) {
    if (args[f.name] === undefined && f.hasDefault) args[f.name] = f.defaultValue;
  }
  return args;
}

/** Upstream wraps bare strings and arrays; unwrap only those exact shapes. */
function unwrapResult(result) {
  const sc = result?.structuredContent;
  if (sc && typeof sc === "object" && !Array.isArray(sc)) {
    const keys = Object.keys(sc);
    if (keys.length === 1 && keys[0] === "text") return sc.text;
    if (keys.length === 1 && keys[0] === "items") return sc.items;
  }
  if (sc !== undefined) return sc;
  if (result && typeof result === "object" && !("content" in result)) return result;
  const first = result?.content?.[0];
  return first?.text ?? null;
}

function helpText() {
  const groups = new Map();
  for (const v of VERBS) {
    const g = v.path[0];
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push(v);
  }
  const lines = [
    `${C.bold("affine")} ${VERSION} — CLI for AFFiNE (no MCP protocol)`,
    "",
    `${C.bold("USAGE")}`,
    "  affine <command> [args] [flags]",
    "  affine invoke <tool> --args '{...}'",
    "",
    `${C.bold("GLOBAL FLAGS")}`,
    "  -w, --workspace <id>   workspace id (default: $AFFINE_WORKSPACE_ID)",
    "      --json / --human   force renderer (default: JSON unless stdout is a TTY)",
    "  -y, --yes              confirm destructive operations",
    "      --profile <name>   full | authoring | core | read_only",
    "",
    `${C.bold("DISCOVERY")}`,
    "  affine tools list [--group <g>]     list all 92 tools",
    "  affine tools describe <tool>        show a tool's JSON Schema",
    "",
    `${C.bold("COMMANDS")}`,
  ];
  for (const [g, verbs] of groups) {
    lines.push(`  ${C.bold(g)}`);
    for (const v of verbs) {
      const cmd = v.path.join(" ") + (v.positional?.length ? " " + v.positional.map((p) => `<${camelToKebab(p)}>`).join(" ") : "");
      lines.push(`    ${cmd.padEnd(42)} ${C.dim(v.summary)}`);
    }
  }
  return lines.join("\n");
}

export async function main(argv) {
  const { globals, rest } = parseGlobals(argv);
  const renderer = pickRenderer(globals);

  if (rest.length === 0 || rest[0] === "help") {
    process.stdout.write(helpText() + "\n");
    return EXIT.OK;
  }
  if (rest[0] === "--version" || rest[0] === "-v" || rest[0] === "version") {
    process.stdout.write(VERSION + "\n");
    return EXIT.OK;
  }

  // Help must work with no configuration and no network: a stub client is
  // enough to read every tool's schema.
  if (globals.help) {
    const stub = new Proxy({}, { get: () => () => { throw new Error("offline"); } });
    const reg = await buildRegistry({ gql: stub, workspaceId: "", baseUrl: "http://localhost" });
    return renderHelp(rest, reg, renderer);
  }

  if (globals.workspace) process.env.AFFINE_WORKSPACE_ID = globals.workspace;

  let gql, config, registry;
  try {
    ({ gql, config } = createClient());
    registry = await buildRegistry({
      gql,
      workspaceId: config.defaultWorkspaceId,
      baseUrl: config.baseUrl,
    });
  } catch (error) {
    // Configuration problems are the caller's to fix, not transient failures.
    emit(renderer, {
      ok: false,
      error: error?.message || String(error),
      code: "config_error",
    });
    return EXIT.USAGE;
  }

  const filter = profileFilter(globals.profile);

  // --- discovery -----------------------------------------------------------
  if (rest[0] === "tools") {
    if (rest[1] === "list" || rest[1] === undefined) {
      const groupFlag = rest.includes("--group") ? rest[rest.indexOf("--group") + 1] : null;
      const tools = [...registry.values()]
        .filter((t) => filter.isEnabled(t.name))
        .map((t) => ({
          name: t.name,
          title: t.spec?.title || "",
          source: t.source || "upstream",
          readOnly: annotations(t.name).readOnlyHint === true,
          destructive: annotations(t.name).destructiveHint === true,
        }))
        .filter((t) => !groupFlag || t.name.includes(groupFlag))
        .sort((a, b) => a.name.localeCompare(b.name));
      emit(renderer, { ok: true, tool: "tools.list", data: { count: tools.length, tools } });
      return EXIT.OK;
    }
    if (rest[1] === "describe") {
      const name = rest[2];
      const entry = registry.get(name);
      if (!entry) {
        const near = suggest(name, [...registry.keys()]);
        emit(renderer, {
          ok: false, tool: "tools.describe", error: `unknown tool "${name}"`, code: "usage_error",
          ...(near.length ? { didYouMean: near } : {}),
        });
        return EXIT.USAGE;
      }
      emit(renderer, {
        ok: true,
        tool: "tools.describe",
        data: {
          name,
          title: entry.spec?.title || "",
          description: entry.spec?.description || "",
          annotations: annotations(name),
          enabled: filter.isEnabled(name),
          inputSchema: toJsonSchema(entry.spec),
        },
      });
      return EXIT.OK;
    }
    emit(renderer, { ok: false, error: `unknown subcommand "tools ${rest[1]}"`, code: "usage_error" });
    return EXIT.USAGE;
  }

  if (rest[0] === "doctor") {
    const parity = await assertManifestParity(registry);
    emit(renderer, {
      ok: true, tool: "doctor",
      data: {
        version: VERSION,
        node: process.version,
        baseUrl: config.baseUrl,
        graphqlEndpoint: config.graphqlEndpoint,
        workspace: config.defaultWorkspaceId || null,
        toolsUpstream: [...registry.values()].filter((t) => t.source === "upstream").length,
        toolsUpstreamExpected: parity.expected,
        toolsLocal: [...registry.values()].filter((t) => t.source === "local").length,
        toolsTotal: registry.size,
        profile: filter.profile,
        toolsEnabled: filter.enabledTools.length,
      },
    });
    return EXIT.OK;
  }

  // --- resolve a tool ------------------------------------------------------
  let toolName;
  let toolArgv;
  let positionalNames = [];

  if (rest[0] === "invoke") {
    toolName = rest[1];
    toolArgv = rest.slice(2);
    if (!toolName) {
      emit(renderer, { ok: false, error: "invoke requires a tool name", code: "usage_error" });
      return EXIT.USAGE;
    }
  } else {
    const verb = findVerb(rest);
    if (!verb) {
      // A bare group name is a request to see that group's verbs.
      const listing = groupHelp(rest[0]);
      if (listing && rest.length === 1) {
        process.stdout.write(listing + "\n");
        return EXIT.USAGE;
      }
      emit(renderer, {
        ok: false,
        error: `unknown command "${rest.join(" ")}"`,
        code: "usage_error",
        ...suggestionFor(rest),
      });
      return EXIT.USAGE;
    }
    toolName = verb.tool;
    toolArgv = rest.slice(verb.path.length);
    positionalNames = verb.positional || [];
  }

  const entry = registry.get(toolName);
  if (!entry) {
    const near = suggest(toolName, [...registry.keys()]);
    emit(renderer, {
      ok: false, tool: toolName, error: `unknown tool "${toolName}"`, code: "usage_error",
      ...(near.length ? { didYouMean: near } : {}),
    });
    return EXIT.USAGE;
  }
  if (!filter.isEnabled(toolName)) {
    emit(renderer, {
      ok: false, tool: toolName,
      error: `"${toolName}" is disabled under profile "${filter.profile}"`,
      code: "tool_disabled",
    });
    return EXIT.PERMISSION;
  }

  // --- run -----------------------------------------------------------------
  try {
    let args = parseToolArgs(entry.spec, toolArgv, positionalNames);
    args = gate(toolName, args, { yes: globals.yes });
    args = validate(entry.spec, args);

    const result = await entry.handler(args);
    if (result?.isError) {
      const sc = result.structuredContent || {};
      emit(renderer, {
        ok: false, tool: toolName,
        error: sc.error || "tool failed",
        code: sc.code || "tool_error",
        retryable: Boolean(sc.retryable),
      });
      return exitCodeFor(sc);
    }
    emit(renderer, { ok: true, tool: toolName, data: unwrapResult(result) });
    return EXIT.OK;
  } catch (error) {
    const code = error?.code || (error instanceof UsageError ? "usage_error" : "cli_error");
    const hint = error instanceof UsageError
      ? { help: `affine ${rest[0] === "invoke" ? `invoke ${toolName}` : (findVerb(rest)?.path.join(" ") || toolName)} --help` }
      : {};
    emit(renderer, { ok: false, tool: toolName, error: error?.message || String(error), code, ...hint });
    if (error instanceof ConfirmationRequired) return EXIT.NEEDS_CONFIRM;
    if (error instanceof UsageError) return EXIT.USAGE;
    return exitCodeFor({ code, error: error?.message || "" });
  }
}


/** Resolve `<command> --help` to either a group listing or a command's schema. */
function renderHelp(rest, registry, renderer) {
  let commandPath, toolName, positional = [];

  if (rest[0] === "invoke" && rest[1]) {
    commandPath = `invoke ${rest[1]}`;
    toolName = rest[1];
  } else {
    const verb = findVerb(rest);
    if (verb) {
      commandPath = verb.path.join(" ");
      toolName = verb.tool;
      positional = verb.positional || [];
    }
  }

  if (!toolName) {
    const listing = groupHelp(rest[0]);
    if (listing) {
      process.stdout.write(listing + "\n");
      return EXIT.OK;
    }
    emit(renderer, {
      ok: false, error: `unknown command "${rest.join(" ")}"`, code: "usage_error",
      ...suggestionFor(rest),
    });
    return EXIT.USAGE;
  }

  const entry = registry.get(toolName);
  if (!entry) {
    const near = suggest(toolName, [...registry.keys()]);
    emit(renderer, {
      ok: false, error: `unknown tool "${toolName}"`, code: "usage_error",
      ...(near.length ? { didYouMean: near } : {}),
    });
    return EXIT.USAGE;
  }

  const payload = { commandPath, toolName, spec: entry.spec, positional };
  if (renderer === "json") {
    emit(renderer, { ok: true, tool: "help", data: helpAsJson(payload) });
  } else {
    process.stdout.write(commandHelp(payload) + "\n");
  }
  return EXIT.OK;
}

/** "did you mean" across both group names and full verb paths. */
function suggestionFor(rest) {
  const paths = VERBS.map((v) => v.path.join(" "));
  const near = [
    ...suggest(rest.join(" "), paths, 2),
    ...suggest(rest[0], [...groups().keys()], 2).map((g) => g),
  ];
  const unique = [...new Set(near)];
  return unique.length ? { didYouMean: unique, help: "affine --help" } : { help: "affine --help" };
}
