// Pure-logic tests: no network, no AFFiNE, no container.
import { test } from "node:test";
import assert from "node:assert/strict";
import { z } from "zod";

import { describeFields, coerce, validate, toJsonSchema, camelToKebab, kebabToCamel, UsageError } from "../src/schema.js";
import { exitCodeFor, EXIT } from "../src/exit.js";
import { gate, isDestructive, isReadOnly, profileFilter, ConfirmationRequired } from "../src/safety.js";
import { pickRenderer } from "../src/render.js";
import { suggest, groups } from "../src/help.js";
import { VERBS, findVerb } from "../src/verbs.js";

const spec = {
  inputSchema: {
    docId: z.string().describe("AFFiNE document id."),
    count: z.number().optional(),
    strict: z.boolean().optional(),
    tags: z.array(z.string()).optional(),
    mode: z.enum(["fast", "slow"]).optional(),
    pageSize: z.number().default(50),
  },
};

test("describeFields: required-ness, defaults, kebab flags", () => {
  const byName = Object.fromEntries(describeFields(spec).map((f) => [f.name, f]));
  assert.equal(byName.docId.required, true);
  assert.equal(byName.count.required, false);
  assert.equal(byName.docId.flag, "--doc-id");
  assert.equal(byName.pageSize.hasDefault, true);
  assert.equal(byName.pageSize.defaultValue, 50);
  assert.equal(byName.strict.isBoolean, true);
  assert.equal(byName.docId.description, "AFFiNE document id.");
});

test("describeFields: unwraps optional/default wrappers to the inner type", () => {
  const byName = Object.fromEntries(describeFields(spec).map((f) => [f.name, f]));
  assert.equal(byName.count.kind, "ZodNumber");
  assert.equal(byName.pageSize.kind, "ZodNumber");
  assert.equal(byName.tags.kind, "ZodArray");
});

test("coerce: strings to the type the schema expects", () => {
  const f = Object.fromEntries(describeFields(spec).map((x) => [x.name, x]));
  assert.equal(coerce(f.count, "42"), 42);
  assert.equal(coerce(f.strict, undefined), true);
  assert.equal(coerce(f.strict, "false"), false);
  assert.equal(coerce(f.strict, "1"), true);
  assert.deepEqual(coerce(f.tags, '["a","b"]'), ["a", "b"]);
  assert.equal(coerce(f.docId, "abc"), "abc");
});

test("coerce: rejects malformed input rather than passing junk downstream", () => {
  const f = Object.fromEntries(describeFields(spec).map((x) => [x.name, x]));
  assert.throws(() => coerce(f.count, "abc"), UsageError);
  assert.throws(() => coerce(f.tags, "not json"), UsageError);
  assert.throws(() => coerce(f.strict, "maybe"), UsageError);
});

test("validate: missing required field is a usage error naming the flag", () => {
  assert.throws(
    () => validate(spec, { count: 1 }),
    (e) => e instanceof UsageError && /missing required --doc-id/.test(e.message),
  );
});

test("validate: unknown argument is rejected, not silently dropped", () => {
  assert.throws(
    () => validate(spec, { docId: "d", nope: 1 }),
    (e) => e instanceof UsageError && /unknown argument "nope"/.test(e.message),
  );
});

test("validate: zod constraint failures surface the zod message", () => {
  assert.throws(
    () => validate(spec, { docId: "d", mode: "sideways" }),
    (e) => e instanceof UsageError && /--mode/.test(e.message),
  );
});

test("validate: returns parsed values on success", () => {
  assert.deepEqual(validate(spec, { docId: "d", count: 3 }), { docId: "d", count: 3 });
});

test("toJsonSchema: types and required list", () => {
  const js = toJsonSchema(spec);
  assert.equal(js.type, "object");
  assert.equal(js.properties.docId.type, "string");
  assert.equal(js.properties.count.type, "number");
  assert.equal(js.properties.tags.type, "array");
  assert.equal(js.properties.pageSize.default, 50);
  assert.deepEqual(js.required, ["docId"]);
});

test("case conversion round-trips", () => {
  assert.equal(camelToKebab("parentDocId"), "parent-doc-id");
  assert.equal(kebabToCamel("parent-doc-id"), "parentDocId");
  assert.equal(kebabToCamel(camelToKebab("workspaceId")), "workspaceId");
});

test("exitCodeFor: maps error shape to stable exit codes", () => {
  assert.equal(exitCodeFor({ code: "usage_error" }), EXIT.USAGE);
  assert.equal(exitCodeFor({ code: "needs_confirmation" }), EXIT.NEEDS_CONFIRM);
  assert.equal(exitCodeFor({ error: "Unauthorized" }), EXIT.AUTH);
  assert.equal(exitCodeFor({ error: "permission denied" }), EXIT.PERMISSION);
  assert.equal(exitCodeFor({ error: "doc not found" }), EXIT.NOT_FOUND);
  assert.equal(exitCodeFor({ retryable: true }), EXIT.RETRYABLE);
  assert.equal(exitCodeFor({ error: "ECONNREFUSED" }), EXIT.RETRYABLE);
  assert.equal(exitCodeFor({ error: "something odd" }), EXIT.GENERIC);
});

test("exitCodeFor: auth beats the generic fallback", () => {
  assert.equal(exitCodeFor({ code: "doc_get_failed", error: "invalid credential" }), EXIT.AUTH);
});

test("safety: destructive classification comes from upstream annotations", () => {
  assert.equal(isDestructive("delete_doc"), true);
  assert.equal(isDestructive("delete_workspace"), true);
  assert.equal(isDestructive("get_doc"), false);
  assert.equal(isReadOnly("get_doc"), true);
});

test("safety: destructive call without --yes is refused", () => {
  assert.throws(
    () => gate("delete_doc", { docId: "d" }, { yes: false }),
    ConfirmationRequired,
  );
});

test("safety: --yes fills the identifier echo upstream requires", () => {
  assert.deepEqual(
    gate("delete_doc", { docId: "d" }, { yes: true }),
    { docId: "d", confirmDocId: "d" },
  );
  assert.deepEqual(
    gate("delete_workspace", { id: "w" }, { yes: true }),
    { id: "w", confirmWorkspaceId: "w" },
  );
});

test("safety: an explicit echo value is never overwritten", () => {
  assert.deepEqual(
    gate("delete_doc", { docId: "d", confirmDocId: "typo" }, { yes: true }),
    { docId: "d", confirmDocId: "typo" },
  );
});

test("safety: non-destructive calls pass through untouched", () => {
  const args = { docId: "d" };
  assert.equal(gate("get_doc", args, { yes: false }), args);
});

test("safety: profiles gate the surface as upstream defines them", () => {
  const ro = profileFilter("read_only");
  assert.equal(ro.isEnabled("get_doc"), true);
  assert.equal(ro.isEnabled("create_doc"), false);
  assert.equal(profileFilter("full").isEnabled("create_doc"), true);
});

test("renderer: JSON unless a TTY, overridable either way", () => {
  assert.equal(pickRenderer({ json: true }), "json");
  assert.equal(pickRenderer({ human: true }), "human");
  assert.equal(pickRenderer({}), process.stdout.isTTY ? "human" : "json");
});

test("suggest: catches near-miss typos and ignores far ones", () => {
  assert.deepEqual(suggest("apend_markdown", ["append_markdown", "create_doc"]), ["append_markdown"]);
  assert.deepEqual(suggest("zzzzzzzzzz", ["append_markdown"]), []);
});

test("findVerb: longest matching path wins", () => {
  assert.equal(findVerb(["doc", "list"]).tool, "list_docs");
  assert.equal(findVerb(["ws", "create"]).tool, "create_workspace");
  assert.equal(findVerb(["nope"]), null);
});

test("verb table has no duplicate command paths", () => {
  const paths = VERBS.map((v) => v.path.join(" "));
  assert.equal(new Set(paths).size, paths.length);
});

test("every verb group is reachable from the group index", () => {
  const index = groups();
  for (const v of VERBS) assert.ok(index.has(v.path[0]), `group ${v.path[0]} missing`);
});
