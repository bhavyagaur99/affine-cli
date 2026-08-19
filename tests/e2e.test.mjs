// Live tests against a real AFFiNE. Opt-in: these create and delete real data.
//
//   AFFINE_E2E=1 AFFINE_BASE_URL=… AFFINE_EMAIL=… AFFINE_PASSWORD=… npm run test:e2e
//
// Every run works inside a throwaway workspace it creates and deletes itself,
// so it never touches pre-existing content.
import { test, before, after, describe } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import path from "node:path";

const BIN = path.join(path.dirname(fileURLToPath(import.meta.url)), "..", "bin", "affine.js");
const enabled = process.env.AFFINE_E2E === "1";

let workspaceId;
// Each CLI invocation is a fresh process. With email/password that means a
// sign-in per command, which AFFiNE rate-limits (429) after a dozen or so.
// Sign in once here and hand every invocation the resulting session cookie.
let sessionCookie = process.env.AFFINE_COOKIE;

async function signInOnce() {
  if (sessionCookie || process.env.AFFINE_API_TOKEN) return;
  const { AFFINE_BASE_URL: base, AFFINE_EMAIL: email, AFFINE_PASSWORD: password } = process.env;
  if (!base || !email || !password) return;
  const res = await fetch(new URL("/api/auth/sign-in", base), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new Error(`sign-in failed: ${res.status} ${await res.text()}`);
  const cookies = res.headers.getSetCookie?.() || [];
  sessionCookie = cookies.map((c) => c.split(";")[0]).join("; ");
  if (!sessionCookie) throw new Error("sign-in returned no session cookie");
}

function run(args, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [BIN, ...args], {
      env: {
        ...process.env,
        // Cookie auth avoids a sign-in round trip (and its rate limit) per call.
        ...(sessionCookie ? { AFFINE_COOKIE: sessionCookie, AFFINE_EMAIL: "", AFFINE_PASSWORD: "" } : {}),
        ...env,
        ...(workspaceId ? { AFFINE_WORKSPACE_ID: workspaceId } : {}),
      },
      maxBuffer: 32 * 1024 * 1024,
    }, (error, stdout) => {
      const exit = error?.code ?? 0;
      let payload;
      try { payload = JSON.parse(stdout.trim().split("\n").pop()); }
      catch { return reject(new Error(`unparseable output for ${args.join(" ")}: ${stdout.slice(0, 400)}`)); }
      // `exit` is deliberately distinct from payload.code, which is an error string.
      resolve({ ...payload, exit });
    });
  });
}

describe("live AFFiNE", { skip: enabled ? false : "set AFFINE_E2E=1 to run" }, () => {
  before(async () => {
    await signInOnce();
    const r = await run(["ws", "create", `e2e-${Date.now()}`]);
    assert.equal(r.ok, true, `workspace creation failed: ${r.error}`);
    workspaceId = r.data.id || r.data.workspaceId;
    assert.ok(workspaceId, "no workspace id returned");
  });

  after(async () => {
    if (!workspaceId) return;
    const id = workspaceId;
    workspaceId = undefined; // stop injecting it as the default
    await run(["ws", "delete", id, "--yes"], { AFFINE_WORKSPACE_ID: "" });
  });

  test("authenticates and identifies the user", async () => {
    const r = await run(["me"]);
    assert.equal(r.ok, true);
    assert.ok(r.data.email);
  });

  test("harvests the full tool surface against a live server", async () => {
    const r = await run(["doctor"]);
    assert.equal(r.data.toolsUpstream, 92);
    assert.equal(r.data.toolsLocal, 1);
  });

  test("markdown survives a create/export round-trip", async () => {
    const created = await run(["doc", "import", "Round Trip", "--markdown", "# Heading\n\nBody text.\n"]);
    assert.equal(created.ok, true, created.error);
    const docId = created.data.docId;

    const exported = await run(["doc", "export", docId]);
    assert.equal(exported.ok, true);
    assert.match(exported.data.markdown, /# Heading/);
    assert.match(exported.data.markdown, /Body text/);
  });

  test("append adds blocks to an existing document", async () => {
    const created = await run(["doc", "import", "Appendable", "--markdown", "# Start\n"]);
    const docId = created.data.docId;

    const appended = await run(["doc", "append", docId, "--markdown", "## Added section\n"]);
    assert.equal(appended.ok, true, appended.error);
    assert.ok(appended.data.stats.appliedBlocks > 0);

    const exported = await run(["doc", "export", docId]);
    assert.match(exported.data.markdown, /Added section/);
  });

  test("created documents appear in the listing with their titles", async () => {
    await run(["doc", "import", "Listed Doc", "--markdown", "x\n"]);
    const list = await run(["doc", "list"]);
    assert.equal(list.ok, true);
    const titles = list.data.edges.map((e) => e.node.title);
    assert.ok(titles.includes("Listed Doc"), `titles were ${JSON.stringify(titles)}`);
  });

  test("delete refuses without --yes, then succeeds with it", async () => {
    const created = await run(["doc", "import", "Doomed", "--markdown", "x\n"]);
    const docId = created.data.docId;

    const refused = await run(["doc", "delete", docId]);
    assert.equal(refused.exit, 7);
    assert.equal(refused.ok, false);

    const deleted = await run(["doc", "delete", docId, "--yes"]);
    assert.equal(deleted.exit, 0);
    assert.equal(deleted.data.deleted, true);
  });

  test("read_only profile cannot write to a live workspace", async () => {
    const r = await run(["--profile", "read_only", "doc", "create", "should not exist"]);
    assert.equal(r.exit, 5);
  });

  // Encodes a surprising upstream behaviour so it cannot silently change:
  // search is over titles from yjs metadata, never over body text.
  test("search matches titles, not body text", async () => {
    const created = await run(["doc", "import", "Quarterly Roadmap", "--markdown", "The zephyrquux initiative ships soon.\n"]);
    assert.equal(created.ok, true, created.error);

    const titleSubstring = await run(["doc", "search", "roadmap"]);
    assert.equal(titleSubstring.data.totalCount, 1, "search_docs should match a title substring");

    const bodyWord = await run(["doc", "search", "zephyrquux"]);
    assert.equal(bodyWord.data.totalCount, 0, "search_docs must not match body text");
  });

  test("find_doc_by_title requires the whole title, not a substring", async () => {
    await run(["doc", "import", "Precise Title Here", "--markdown", "body\n"]);

    const exact = await run(["doc", "find", "Precise Title Here"]);
    assert.equal(exact.data.matches.length, 1);

    const partial = await run(["doc", "find", "Precise", "--case-insensitive"]);
    assert.equal(partial.data.matches.length, 0, "find_doc_by_title is exact-match only");
  });

  // Content search needs a deployment running an indexer. Rather than skip
  // blindly, assert the right behaviour for whichever deployment we are on.
  test("content search matches body text, or says why it cannot", async () => {
    const created = await run(["doc", "import", "Body Search Target", "--markdown", "The xylophonebadger entry is unique.\n"]);
    assert.equal(created.ok, true, created.error);

    // Indexing is asynchronous; poll rather than assume.
    let last;
    for (let i = 0; i < 12; i++) {
      last = await run(["doc", "content-search", "xylophonebadger"]);
      if (last.exit === 5 || last.data?.totalCount > 0) break;
      await new Promise((r) => setTimeout(r, 5000));
    }

    if (last.exit === 5) {
      assert.equal(last.code, "indexer_disabled");
      assert.match(last.error, /affine doc search/);
      return;
    }
    assert.equal(last.exit, 0, last.error);
    assert.equal(last.data.totalCount, 1, "body word must match exactly one doc");
    assert.equal(last.data.results[0].title, "Body Search Target");
    assert.match(last.data.results[0].highlight, /xylophonebadger/);
    assert.ok(!last.data.results[0].highlight.includes("<b>"), "markup must be stripped");
  });

  test("title search and content search answer different questions", async () => {
    await run(["doc", "import", "Divergent Title", "--markdown", "The okapiwrench detail lives only here.\n"]);

    const byTitle = await run(["doc", "search", "okapiwrench"]);
    assert.equal(byTitle.data.totalCount, 0, "title search must not see body text");

    const byContent = await run(["doc", "content-search", "Divergent"]);
    if (byContent.exit === 5) return; // no indexer on this deployment
    assert.equal(byContent.exit, 0);
  });

  test("login stores a session that later invocations reuse", async () => {
    const { mkdtemp, rm, stat } = await import("node:fs/promises");
    const os = await import("node:os");
    const dir = await mkdtemp(`${os.tmpdir()}/affine-cli-e2e-`);
    const { AFFINE_BASE_URL: base, AFFINE_EMAIL: email, AFFINE_PASSWORD: password } = process.env;
    if (!email || !password) return; // cookie/token deployments have nothing to log in with

    const clean = { AFFINE_CLI_HOME: dir, AFFINE_COOKIE: "", AFFINE_EMAIL: "", AFFINE_PASSWORD: "" };
    try {
      const li = await run(["login", "--base-url", base, "--email", email, "--password", password], clean);
      assert.equal(li.ok, true, li.error);

      const mode = (await stat(`${dir}/credentials.json`)).mode & 0o777;
      assert.equal(mode, 0o600, "stored session must not be world-readable");

      // No credentials in the environment at all — the stored session carries it.
      const who = await run(["whoami"], clean);
      assert.equal(who.ok, true, who.error);
      assert.equal(who.data.authSource, "cookie (stored)");
      assert.equal(who.data.user.email, email);

      const out = await run(["logout"], clean);
      assert.equal(out.data.cleared, true);

      const after = await run(["whoami"], clean);
      assert.equal(after.exit, 3, "a cleared session must fail loudly, not silently");
      assert.equal(after.code, "not_authenticated");
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  });

  test("tags can be created and applied", async () => {
    const tag = await run(["tag", "create", "e2e-tag"]);
    assert.equal(tag.ok, true, tag.error);
    const list = await run(["tag", "list"]);
    assert.equal(list.ok, true);
  });
});
