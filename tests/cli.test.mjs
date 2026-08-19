// End-to-end tests of the real binary, driven against a stub GraphQL server.
// No AFFiNE and no container required — these run anywhere.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "affine.js");

let server;
let baseUrl;
const seen = [];

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(body);
      res.setHeader("content-type", "application/json");
      if (/currentUser/.test(body)) {
        return res.end(JSON.stringify({ data: { currentUser: { id: "u1", name: "Ada", email: "ada@example.com" } } }));
      }
      if (/workspaces/.test(body)) {
        return res.end(JSON.stringify({ data: { workspaces: [{ id: "ws1", public: false, createdAt: 1 }] } }));
      }
      if (/GetWorkspace|workspace\s*\(/.test(body)) {
        return res.end(JSON.stringify({ errors: [{ message: "You do not have permission to access Space ws9." }] }));
      }
      res.end(JSON.stringify({ data: {} }));
    });
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(() => server.close());

/** Run the CLI; never inherit ambient AFFINE_* config from the developer's shell. */
function run(args, { env = {}, auth = true } = {}) {
  const clean = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("AFFINE_")));
  return new Promise((resolve) => {
    execFile(process.execPath, [BIN, ...args], {
      env: {
        ...clean,
        ...(auth ? { AFFINE_BASE_URL: baseUrl, AFFINE_API_TOKEN: "test-token" } : {}),
        ...env,
      },
    }, (error, stdout, stderr) => {
      resolve({ code: error?.code ?? 0, stdout, stderr });
    });
  });
}

const parse = (stdout) => JSON.parse(stdout.trim().split("\n").pop());

test("successful call returns the ok envelope and exit 0", async () => {
  const r = await run(["me"]);
  assert.equal(r.code, 0);
  const out = parse(r.stdout);
  assert.equal(out.ok, true);
  assert.equal(out.tool, "current_user");
  assert.deepEqual(out.data, { id: "u1", name: "Ada", email: "ada@example.com" });
});

test("stdout carries only the payload; diagnostics go to stderr", async () => {
  const r = await run(["me"]);
  assert.doesNotThrow(() => JSON.parse(r.stdout.trim()), "stdout must be parseable as a single JSON document");
});

test("JSON is the default renderer when stdout is not a TTY", async () => {
  const r = await run(["me"]);
  assert.match(r.stdout.trim(), /^\{/);
});

test("server-side failure maps to a non-zero exit and an error envelope", async () => {
  const r = await run(["ws", "get", "ws9"]);
  assert.notEqual(r.code, 0);
  const out = parse(r.stdout);
  assert.equal(out.ok, false);
  assert.match(out.error, /permission/i);
  assert.equal(out.code, "workspace_get_failed");
});

test("permission denial exits 5", async () => {
  const r = await run(["ws", "get", "ws9"]);
  assert.equal(r.code, 5);
});

test("missing required argument exits 2 and names the flag plus its help", async () => {
  const r = await run(["doc", "read"]);
  assert.equal(r.code, 2);
  const out = parse(r.stdout);
  assert.equal(out.code, "usage_error");
  assert.match(out.error, /--doc-id/);
  assert.equal(out.help, "affine doc read --help");
});

test("unknown command exits 2 with suggestions", async () => {
  const r = await run(["doc", "lst"]);
  assert.equal(r.code, 2);
  assert.ok(parse(r.stdout).didYouMean.includes("doc list"));
});

test("unknown tool exits 2 with suggestions", async () => {
  const r = await run(["invoke", "apend_markdown"]);
  assert.equal(r.code, 2);
  assert.ok(parse(r.stdout).didYouMean.includes("append_markdown"));
});

test("destructive command without --yes exits 7 and performs no request", async () => {
  const before = seen.length;
  const r = await run(["doc", "delete", "d1"]);
  assert.equal(r.code, 7);
  assert.equal(parse(r.stdout).code, "needs_confirmation");
  assert.equal(seen.length, before, "must not reach the server before confirmation");
});

test("read_only profile blocks a write and exits 5", async () => {
  const r = await run(["--profile", "read_only", "doc", "create", "x"]);
  assert.equal(r.code, 5);
  assert.equal(parse(r.stdout).code, "tool_disabled");
});

test("invalid configuration exits 2, not a transient code", async () => {
  const r = await run(["doctor"], { auth: false, env: { AFFINE_BASE_URL: "http://example.com:3010" } });
  assert.equal(r.code, 2);
  assert.equal(parse(r.stdout).code, "config_error");
});

test("doctor reports full harvest parity", async () => {
  const r = await run(["doctor"]);
  assert.equal(r.code, 0);
  const { data } = parse(r.stdout);
  assert.equal(data.toolsHarvested, 92);
  assert.equal(data.toolsExpected, data.toolsHarvested);
});

test("tools list exposes the whole surface with safety metadata", async () => {
  const r = await run(["tools", "list"]);
  const { data } = parse(r.stdout);
  assert.equal(data.count, 92);
  assert.equal(data.tools.find((t) => t.name === "delete_doc").destructive, true);
  assert.equal(data.tools.find((t) => t.name === "get_doc").readOnly, true);
});

test("tools describe returns a usable JSON Schema", async () => {
  const r = await run(["tools", "describe", "append_markdown"]);
  const { data } = parse(r.stdout);
  assert.deepEqual(data.inputSchema.required.sort(), ["docId", "markdown"]);
  assert.equal(data.inputSchema.properties.markdown.type, "string");
});

test("help works with no configuration and no network", async () => {
  const r = await run(["doc", "import", "--help"], { auth: false });
  assert.equal(r.code, 0);
  const { data } = parse(r.stdout);
  assert.equal(data.tool, "create_doc_from_markdown");
  assert.ok(data.flags.some((f) => f.flag === "--markdown" && f.required));
});

test("help marks destructive commands and the --yes auto-fill", async () => {
  const r = await run(["doc", "delete", "--help"], { auth: false });
  const { data } = parse(r.stdout);
  assert.equal(data.requiresYes, true);
  const echo = data.flags.find((f) => f.flag === "--confirm-doc-id");
  assert.equal(echo.autoFilledByYes, true);
  assert.equal(echo.required, false, "--yes supplies it, so it must not read as required");
});

test("invoke --help covers tools with no curated verb", async () => {
  const r = await run(["invoke", "compose_database_from_intent", "--help"], { auth: false });
  assert.equal(r.code, 0);
  assert.equal(parse(r.stdout).data.tool, "compose_database_from_intent");
});

test("--args and repeated --arg reach the tool identically", async () => {
  const a = await run(["invoke", "get_doc", "--args", '{"workspaceId":"w","docId":"d"}']);
  const b = await run(["invoke", "get_doc", "--arg", "workspaceId=w", "--arg", "doc-id=d"]);
  assert.equal(a.code, b.code);
});

test("malformed --args is a usage error, not a crash", async () => {
  const r = await run(["invoke", "get_doc", "--args", "{oops"]);
  assert.equal(r.code, 2);
  assert.match(parse(r.stdout).error, /JSON/);
});

test("-w overrides the configured workspace", async () => {
  const r = await run(["doctor", "-w", "ws-override"], { env: { AFFINE_WORKSPACE_ID: "ws-env" } });
  assert.equal(parse(r.stdout).data.workspace, "ws-override");
});

test("--version prints a bare version", async () => {
  const r = await run(["--version"], { auth: false });
  assert.equal(r.code, 0);
  assert.match(r.stdout.trim(), /^\d+\.\d+\.\d+$/);
});
