# affine-cli — design

A command-line interface to AFFiNE, usable by humans at a terminal and by agents
that shell out to processes. No MCP protocol at any layer.

Built on `affine-mcp-server` as a **library dependency**, not a fork.

---

## 1. Constraint

The target environment cannot register MCP tools. Agents interact with the world
by running processes (`ls`, `cat`, `mkdir`). So the tool surface must be reachable
through `argv` + stdout, not through a protocol.

This rules out the `@khanglvm/affine-cli` design, which presents a CLI but
internally spawns `affine-mcp` and speaks MCP JSON-RPC over stdio to it.

---

## 2. Verified facts

All confirmed by probe against `affine-mcp-server@3.2.2` on Node v22.23.2.

| Claim | Result |
|---|---|
| Package publishes `dist/`, declares no `exports` map | confirmed — deep imports legal |
| `dist/tools/*.js` import with no top-level side effects | confirmed — 12/12 clean, no stderr, no config read |
| `registerXTools()` accepts a duck-typed collector | confirmed — never touches anything on `server` beyond `.registerTool` |
| Full tool surface harvestable in-process | **92/92**, exact parity with `tool-manifest.json` (0 missing, 0 extra) |
| Handlers are plain callable async functions | confirmed |
| Success envelope | `{ content, structuredContent, isError: false }` |
| Failure envelope | `{ content, structuredContent: { ok:false, error, code, retryable }, isError: true }` |
| Core modules deep-import cleanly | `graphqlClient.js`, `config.js`, `authSession.js`, `ws.js`, `toolSurface.js` |
| Safety metadata reusable | `toolAnnotationsFor(name)` → `{ readOnlyHint, destructiveHint, idempotentHint }` |
| Profile filtering reusable | `createToolFilter()` → read_only=32, core=29, authoring=66, full=92 |

Per-module harvest: docs 47, organize 16, workspaces 5, comments 5, properties 5,
icons 4, blobStorage 3, notifications 2, userCRUD 2, auth 1, history 1, user 1.

---

## 3. Architecture

```
argv ──> command router ──> tool registry (Map<string, {spec, handler}>)
                                  │
                                  │  in-process function call
                                  ▼
                   affine-mcp-server/dist/tools/*.js
                                  │
                    GraphQLClient ─┴─ ws.ts (socket.io + yjs)
                                  ▼
                             AFFiNE server
```

The collector shim, in full:

```js
const registry = new Map();
const collector = { registerTool: (name, spec, handler) => registry.set(name, { spec, handler }) };

registerWorkspaceTools(collector, gql, { workspaceId });
registerDocTools(collector, gql, { workspaceId });
// …ten more
```

That is the entire adaptation. `@modelcontextprotocol/sdk` is never imported by
our code; it remains only as a transitive dependency of the upstream package.

### Why depend rather than fork

| | Fork/vendor | Depend |
|---|---|---|
| Code owned | ~20,700 LOC | ~1,500 LOC |
| Upstream fixes | manual merge | `npm update` |
| Risk | merge drift | deep-import breakage |

Upstream ships frequently (3.2.2 released 2026-08-18). Pin an exact version;
bump deliberately after running the parity check in §9.

---

## 4. Repo layout

```
affine-cli/
  bin/affine.js              # shebang entry
  src/
    registry.js              # collector shim; builds the 92-tool Map
    client.js                # GraphQLClient + AuthSession construction
    config.js                # profiles, base URL, default workspace
    credentials.js           # keychain w/ file fallback (0600)
    router.js                # argv -> tool + args
    verbs.js                 # curated verb table (data, not code)
    schema.js                # zod inputSchema -> CLI flags + help + JSON Schema
    render/
      json.js                # agent renderer
      human.js               # TTY renderer (tables, color)
    safety.js                # destructive gating
    exit.js                  # error code -> exit code
  types/affine-mcp-server.d.ts   # ~40-line shim; upstream ships no .d.ts
  docs/AGENT.md              # onboarding doc for agents
  DESIGN.md
```

---

## 5. Command surface

Two layers over one registry.

### 5.1 `invoke` — complete, from day one

```
affine invoke <tool> --args '{"workspaceId":"…","docId":"…"}'
affine invoke get_doc --arg workspaceId=… --arg docId=…      # repeatable k=v
affine tools list [--group docs.write] [--profile read_only] [--json]
affine tools describe get_doc [--json]                        # JSON Schema out
```

All 92 tools, no per-tool code. Flags and validation are derived from each tool's
zod `inputSchema` — `.description` becomes help text, `.isOptional()` becomes
required-ness. This is what agents use for anything uncommon.

### 5.2 Curated verbs — ergonomic, ~25 of them

A declarative table maps verb paths to tools, so adding one is a data edit:

```js
{ path: ["doc", "read"],   tool: "export_doc_markdown", positional: ["docId"] },
{ path: ["doc", "search"], tool: "search_docs",         positional: ["query"] },
{ path: ["ws", "list"],    tool: "list_workspaces" },
```

Planned groups: `ws`, `doc`, `db`, `tag`, `folder`, `collection`, `comment`,
`blob`, `canvas`, `me`, `login`, `profile`.

### 5.3 Global flags

`-w/--workspace` (defaults from config) · `--json` / `--human` · `--yes`
· `--profile <name>` · `--timeout <ms>` · `--quiet`

---

## 6. Auth and config

Reuses upstream `config.js` and `AuthSession` — token, cookie, or email+password,
in that precedence.

- Non-secret config: `~/.config/affine-cli/config.json` — base URL, default
  workspace, named profiles.
- Secrets: OS keychain when available, else `0600` file. Never in config.json,
  never echoed, never in `--help`.
- `affine login` runs interactively; `AFFINE_API_TOKEN` env var works headless.
- Reads an existing `~/.config/affine-mcp/config` on first run and offers import.

---

## 7. Output contract

**Renderer selection:** JSON when stdout is not a TTY, human when it is.
`--json` / `--human` override. Agents therefore get JSON with no flag needed,
and a human piping to `jq` gets JSON automatically.

```jsonc
// success
{ "ok": true,  "tool": "get_doc", "data": { … } }
// failure
{ "ok": false, "tool": "get_doc", "error": "…", "code": "doc_get_failed", "retryable": false }
```

`code` is passed through verbatim from upstream so it stays stable across
versions. stdout carries **only** the payload; all logs and diagnostics go to
stderr.

**Exit codes:**

| Code | Meaning |
|---|---|
| 0 | success |
| 2 | usage / validation error (bad flags, schema mismatch) |
| 3 | authentication failure |
| 4 | not found |
| 5 | permission denied |
| 6 | network / retryable (`retryable: true`) |
| 7 | confirmation required but not given |
| 1 | everything else |

---

## 8. Safety

Gating is derived from upstream metadata rather than a hand-maintained list:

- `toolAnnotationsFor(name).destructiveHint` → requires `--yes`, or an
  interactive confirm on a TTY. Non-TTY without `--yes` exits 7.
- Tools calling `requireMatchingConfirmation` get their literal confirmation
  string passed through; `--yes` alone will not satisfy them.
- `--profile read_only` (32 tools) via upstream `createToolFilter`. Recommended
  default for unattended agents; `full` requires opting in.

---

## 9. Risks

| Risk | Mitigation |
|---|---|
| Upstream adds an `exports` map, breaking deep imports | pin exact version; fallback is vendoring `dist/` |
| Upstream renames a `registerXTools` export | parity check in CI: harvested count must equal `tool-manifest.json` |
| No published `.d.ts` | ~40-line local shim in `types/` |
| Writes need a websocket handshake per doc mutation | batch within one session; reuse the socket across a command |
| `dist/index.js` boots a server and calls `process.exit` | never import it; lint rule forbidding the path |

---

## 10. Build order

1. Registry + collector, `invoke`, `tools list/describe`, JSON renderer, exit codes.
   → agents fully unblocked, all 92 tools, no per-tool code.
2. Auth, config, profiles, credential storage.
3. Curated verbs + human renderer + destructive gating.
4. `docs/AGENT.md`, shell completions, CI parity check.

Phase 1 is the whole agent requirement. Phases 3–4 are the human half.

---

## 11. Status (built and verified)

Phase 1 is complete and Docker packaging is done. Verified against a live
self-hosted **AFFiNE 0.27.4** (`ghcr.io/toeverything/affine:stable`) running in
Docker Compose at `../affine-stack`.

Implementation deviates from §4 in one way: **plain ESM JavaScript, no
TypeScript.** That removes the missing-`.d.ts` problem entirely and drops the
build step, which keeps the Docker image at 300 MB with no compile stage.

Test suite: 52 committed tests (23 unit, 21 CLI, 8 live) plus the static
parity check. All green on host and inside the container.

| Area | Verified |
|---|---|
| Harvest | 92/92, manifest parity |
| Reads | `me`, `ws list`, `doc list`, `doc export`, `tools list/describe` |
| Writes (yjs/websocket) | `ws create`, `doc import`, `doc append`, `tag create`, `doc delete` |
| Markdown round-trip | import → export returns equivalent Markdown |
| Exit codes | 0 / 2 / 5 / 7 all confirmed |
| Safety | destructive refused without `--yes`; `--profile read_only` blocks writes |
| Docker | reads, writes, volume mounts, network modes, non-root |

### Search is title-only (verified)

Neither `search_docs` nor `find_doc_by_title` performs full-text search, and
**neither uses AFFiNE's indexer at all**. Both read the workspace's yjs
metadata over the websocket and match against document *titles*:

| Query | `search_docs` | `find_doc_by_title` |
|---|---|---|
| `Quarterly Roadmap` (exact title) | 1 | 1 |
| `roadmap` (title substring) | 1 | 0 |
| `Quarterly` (title substring) | 1 | 0 |
| `zephyrquux` (body text only) | **0** | **0** |

So `search_docs` is a case-insensitive title substring match, and
`find_doc_by_title` is an exact title match. Body text is never searched.
Upstream says so directly at `src/tools/docs.ts:4588` — *"fast title search via
workspace metadata"* — and no tool in the 92 queries the indexer.

This was confirmed by standing up Manticoresearch and setting
`AFFINE_INDEXER_ENABLED=true`: AFFiNE indexed the documents (the `doc` table
appears in Manticore) and body-text search results **did not change**. Running
the indexer buys the CLI nothing; it only serves AFFiNE's own web UI search.

Full-text search would require a new tool issuing AFFiNE's server-side search
query — an upstream feature request, not a CLI change.

### Other environment notes

- A deleted doc briefly remains in `list_docs` as a null-titled tombstone. That
  is AFFiNE's own deletion behaviour.

### Auth rate limiting (found during e2e)

AFFiNE rate-limits `/api/auth/sign-in`. Because every CLI invocation is a new
process, email/password authentication signs in *per command* and a rapid
sequence hits `429` after roughly a dozen calls. Token and cookie auth are
unaffected — they carry credentials directly and never call sign-in.

This is the strongest argument for phase 2's cached session: an agent doing
twenty operations should authenticate once, not twenty times. Until then,
`AFFINE_API_TOKEN` is the correct choice for any non-interactive caller, and
the e2e suite signs in once and reuses the cookie for exactly this reason.

### Not yet built (phases 2–4)

Credential storage (keychain), named profiles, `affine login`, shell
completions, interactive TTY confirmation prompts. Auth today is environment
variables only — which is what Docker wants anyway.
