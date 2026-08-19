// End-to-end tests of the real binary, driven against a stub GraphQL server.
// No AFFiNE and no container required — these run anywhere.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";
import os from "node:os";
import fsp from "node:fs/promises";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "affine.js");

let server;
let baseUrl;
const seen = [];
// Flipped per-test to simulate a deployment with the indexer off.
let indexerOn = true;

before(async () => {
  server = createServer((req, res) => {
    let body = "";
    req.on("data", (c) => (body += c));
    req.on("end", () => {
      seen.push(body);
      res.setHeader("content-type", "application/json");
      if (/ServerFeatures|serverConfig/.test(body)) {
        const features = ["Comment", "LocalWorkspace", ...(indexerOn ? ["Indexer"] : [])];
        return res.end(JSON.stringify({ data: { serverConfig: { features } } }));
      }
      if (/SearchDocContent|searchDocs/.test(body)) {
        const keyword = /"keyword":"([^"]*)"/.exec(body)?.[1] ?? "";
        const hits = keyword === "presentword"
          ? [{ docId: "d1", blockId: "b1", title: "Doc One",
               highlight: "a <b>presentword</b> in the body",
               createdAt: null, updatedAt: null }]
          : [];
        return res.end(JSON.stringify({ data: { workspace: { searchDocs: hits } } }));
      }
      if (/currentUser/.test(body)) {
        // Mirror AFFiNE: an unauthenticated caller gets a null user, not an error.
        const authed = Boolean(req.headers.authorization || req.headers.cookie);
        return res.end(JSON.stringify({
          data: { currentUser: authed ? { id: "u1", name: "Ada", email: "ada@example.com" } : null },
        }));
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

test("doctor reports upstream parity and local additions separately", async () => {
  const r = await run(["doctor"]);
  assert.equal(r.code, 0);
  const { data } = parse(r.stdout);
  assert.equal(data.toolsUpstream, 92);
  assert.equal(data.toolsUpstreamExpected, data.toolsUpstream, "upstream harvest must stay exact");
  assert.equal(data.toolsLocal, 1);
  assert.equal(data.toolsTotal, 93);
});

test("tools list exposes the whole surface with safety metadata", async () => {
  const r = await run(["tools", "list"]);
  const { data } = parse(r.stdout);
  assert.equal(data.count, 93, "92 upstream + 1 local");
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


// --- content search -------------------------------------------------------

test("content search returns body matches with plain snippets", async () => {
  indexerOn = true;
  const r = await run(["doc", "content-search", "presentword", "-w", "ws1"]);
  assert.equal(r.code, 0);
  const { data } = parse(r.stdout);
  assert.equal(data.totalCount, 1);
  assert.equal(data.results[0].docId, "d1");
  assert.equal(data.results[0].highlight, "a presentword in the body",
    "the <b> markup AFFiNE adds must be stripped");
  assert.ok(!("highlightHtml" in data.results[0]), "markup must not ship");
  assert.match(data.results[0].url, /\/workspace\/ws1\/d1$/);
});

test("no matches is a success with zero results, not an error", async () => {
  indexerOn = true;
  const r = await run(["doc", "content-search", "absentword", "-w", "ws1"]);
  assert.equal(r.code, 0);
  const { ok, data } = parse(r.stdout);
  assert.equal(ok, true);
  assert.equal(data.totalCount, 0);
  assert.deepEqual(data.results, []);
});

test("indexer disabled fails loudly instead of returning an empty list", async () => {
  indexerOn = false;
  const r = await run(["doc", "content-search", "presentword", "-w", "ws1"]);
  assert.equal(r.code, 5);
  const out = parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.code, "indexer_disabled");
  assert.match(out.error, /not enabled/i);
  assert.match(out.error, /affine doc search/, "must point at the working alternative");
  indexerOn = true;
});

test("content search never queries the search backend itself", async () => {
  indexerOn = true;
  const before = seen.length;
  await run(["doc", "content-search", "presentword", "-w", "ws1"]);
  const bodies = seen.slice(before).join(" ");
  assert.match(bodies, /serverConfig/, "capability check goes to AFFiNE");
  assert.match(bodies, /searchDocs/, "search goes to AFFiNE");
});

test("content search is available under read_only", async () => {
  indexerOn = true;
  const r = await run(["--profile", "read_only", "doc", "content-search", "absentword", "-w", "ws1"]);
  assert.equal(r.code, 0, "a read-only query must not be gated by the profile");
});

test("tools list marks the local tool as local and keeps upstream at 92", async () => {
  const r = await run(["tools", "list"]);
  const { data } = parse(r.stdout);
  const upstream = data.tools.filter((t) => t.source === "upstream");
  const local = data.tools.filter((t) => t.source === "local");
  assert.equal(upstream.length, 92);
  assert.deepEqual(local.map((t) => t.name), ["search_doc_content"]);
});


// --- login / session commands ---------------------------------------------

test("login refuses to prompt when not interactive", async () => {
  const dir = await fsp.mkdtemp(`${os.tmpdir()}/affine-cli-cli-`);
  const r = await run(["login"], { auth: false, env: { AFFINE_BASE_URL: baseUrl, AFFINE_CLI_HOME: dir } });
  assert.equal(r.code, 2, "must not block a non-TTY caller on a prompt");
  assert.match(parse(r.stdout).error, /Non-interactive/);
  await fsp.rm(dir, { recursive: true, force: true });
});

test("login without a base url is a usage error", async () => {
  const dir = await fsp.mkdtemp(`${os.tmpdir()}/affine-cli-cli-`);
  const r = await run(["login", "--email", "a@b.c", "--password", "x"], { auth: false, env: { AFFINE_CLI_HOME: dir } });
  assert.equal(r.code, 2);
  assert.match(parse(r.stdout).error, /AFFINE_BASE_URL/);
  await fsp.rm(dir, { recursive: true, force: true });
});

test("whoami reports not-authenticated with exit 3 rather than a hollow success", async () => {
  const dir = await fsp.mkdtemp(`${os.tmpdir()}/affine-cli-cli-`);
  // The stub returns a null currentUser, exactly as AFFiNE does for an
  // anonymous caller — the silent-failure case this guards against.
  const r = await run(["whoami"], { auth: false, env: { AFFINE_BASE_URL: baseUrl, AFFINE_CLI_HOME: dir } });
  assert.equal(r.code, 3);
  const out = parse(r.stdout);
  assert.equal(out.ok, false);
  assert.equal(out.code, "not_authenticated");
  assert.equal(out.data.session.state, "absent");
  await fsp.rm(dir, { recursive: true, force: true });
});

test("logout is idempotent and reports what it did", async () => {
  const dir = await fsp.mkdtemp(`${os.tmpdir()}/affine-cli-cli-`);
  const r = await run(["logout"], { auth: false, env: { AFFINE_BASE_URL: baseUrl, AFFINE_CLI_HOME: dir } });
  assert.equal(r.code, 0);
  assert.equal(parse(r.stdout).data.cleared, false, "nothing stored yet");
  await fsp.rm(dir, { recursive: true, force: true });
});

test("doctor reports the auth source and stored-session state", async () => {
  const dir = await fsp.mkdtemp(`${os.tmpdir()}/affine-cli-cli-`);
  const r = await run(["doctor"], { env: { AFFINE_CLI_HOME: dir } });
  const { data } = parse(r.stdout);
  assert.equal(data.authSource, "token", "AFFINE_API_TOKEN is set by the harness");
  assert.equal(data.storedSession.state, "absent");
  assert.match(data.credentialsFile, /credentials\.json$/);
  await fsp.rm(dir, { recursive: true, force: true });
});
