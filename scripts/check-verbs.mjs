// CI guard: every verb must name a real tool, and every positional must name a
// real field on that tool's schema. Also asserts full manifest parity.
import { buildRegistry, assertManifestParity } from "../src/registry.js";
import { describeFields } from "../src/schema.js";
import { VERBS } from "../src/verbs.js";
import { commandHelp, helpAsJson } from "../src/help.js";

const gql = new Proxy({}, { get: () => () => { throw new Error("no network at check time"); } });
const registry = await buildRegistry({ gql, workspaceId: "ws", baseUrl: "http://localhost" });
const parity = await assertManifestParity(registry);

let failures = 0;
for (const verb of VERBS) {
  const cmd = verb.path.join(" ");
  const entry = registry.get(verb.tool);
  if (!entry) { console.log(`FAIL ${cmd}: unknown tool "${verb.tool}"`); failures++; continue; }
  const fields = new Set(describeFields(entry.spec).map((f) => f.name));
  for (const p of verb.positional || []) {
    if (!fields.has(p)) {
      const req = describeFields(entry.spec).filter((f) => f.required).map((f) => f.name);
      console.log(`FAIL ${cmd}: positional "${p}" not in ${verb.tool}; required=[${req.join(", ")}]`);
      failures++;
    }
  }
}
// Help is generated, so a schema shape we mishandle would throw here, not in a user's terminal.
for (const verb of VERBS) {
  const entry = registry.get(verb.tool);
  if (!entry) continue;
  const payload = {
    commandPath: verb.path.join(" "),
    toolName: verb.tool,
    spec: entry.spec,
    positional: verb.positional || [],
  };
  try {
    if (!commandHelp(payload).includes("USAGE")) throw new Error("no USAGE section");
    helpAsJson(payload);
  } catch (error) {
    console.log(`FAIL help ${payload.commandPath}: ${error.message}`);
    failures++;
  }
}
// Every tool must render help via `invoke <tool> --help`, not just the curated verbs.
for (const [name, entry] of registry) {
  try { commandHelp({ commandPath: `invoke ${name}`, toolName: name, spec: entry.spec }); }
  catch (error) { console.log(`FAIL help invoke ${name}: ${error.message}`); failures++; }
}

console.log(`\nparity ${parity.harvested}/${parity.expected} · verbs ${VERBS.length} · help ${VERBS.length + registry.size} rendered · failures ${failures}`);
process.exit(failures ? 1 : 0);
