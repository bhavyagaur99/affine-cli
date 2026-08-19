# affine-cli

A CLI for AFFiNE that works for people at a terminal and for agents that shell
out to processes. **No MCP protocol at any layer** — no server, no stdio
transport, no JSON-RPC, no subprocess.

It builds on [`affine-mcp-server`](https://github.com/DAWNCR0W/affine-mcp-server)
as a library: the upstream `registerXTools()` functions are handed a collector
object instead of an `McpServer`, which yields all 92 tool handlers as ordinary
in-process async functions. MIT on both sides.

## Run with Docker (recommended)

Pull the published image:

```bash
docker pull ghcr.io/bhavyagaur99/affine-cli:latest
```

Or build it yourself:

```bash
docker build -t affine-cli:0.1.0 .

docker run --rm \
  -e AFFINE_BASE_URL=https://app.affine.pro \
  -e AFFINE_API_TOKEN=$AFFINE_API_TOKEN \
  -e AFFINE_WORKSPACE_ID=$WS \
  affine-cli:0.1.0 doc list
```

The entrypoint *is* the binary, so `docker run affine-cli doc list` reads like
`affine doc list`. Output is JSON by default because the container has no TTY.

**Talking to a self-hosted AFFiNE:**

| AFFiNE location | Flags |
|---|---|
| Same compose network | `--network affine_default -e AFFINE_BASE_URL=http://affine:3010` |
| Docker host | `--add-host host.docker.internal:host-gateway -e AFFINE_BASE_URL=http://host.docker.internal:3010` |
| Host network | `--network host -e AFFINE_BASE_URL=http://localhost:3010` |

Plain HTTP to a non-loopback host is refused unless you set
`AFFINE_ALLOW_INSECURE_HTTP=true`. That guard comes from upstream and is worth
keeping outside a trusted private network.

**Files:** mount a directory to pass Markdown in or get exports out.

```bash
docker run --rm -v "$PWD:/work" … affine-cli:0.1.0 \
  doc import "Notes" --markdown "$(cat /work/notes.md)"
```

**Sessions:** a container's filesystem is discarded on exit, so `affine login`
only persists if `/config` is mounted. The image pre-creates `/config` owned by
the runtime user and defaults `AFFINE_CLI_HOME` to it, so a named volume just
works:

```bash
docker volume create affine-cli-config
docker run --rm -v affine-cli-config:/config … affine-cli:0.1.0 login --email … --password …
docker run --rm -v affine-cli-config:/config … affine-cli:0.1.0 doc list      # reuses it
```

Omit the mount and every container starts logged out. The alternative is to
skip storage entirely and pass `-e AFFINE_COOKIE=…` per run — equally valid,
and often simpler in CI where the credential comes from a secret store.

## Run with Node

```bash
npm install
export AFFINE_BASE_URL=http://localhost:3010
export AFFINE_EMAIL=… AFFINE_PASSWORD=…
node bin/affine.js doc list
```

Requires Node ≥ 20.18.1.

## Authentication

Precedence, highest first — set exactly one:

| Variable | Notes |
|---|---|
| `AFFINE_API_TOKEN` | fastest; preferred for agents and CI |
| `AFFINE_COOKIE` | AFFiNE Cloud session |
| `AFFINE_EMAIL` + `AFFINE_PASSWORD` | works cleanly on self-hosted |

Plus `AFFINE_BASE_URL` (required) and `AFFINE_WORKSPACE_ID` (optional default,
overridable per command with `-w`).

## Commands

```
affine <group> <verb> [args] [flags]      # 46 curated verbs
affine invoke <tool> --args '{…}'         # all 93 tools
affine tools list                         # discovery
affine tools describe <tool>              # JSON Schema for one tool
affine doctor                             # config + harvest diagnostics
```

### Search

Two different questions, two different commands:

| Command | Searches | Needs an indexer |
|---|---|---|
| `affine doc search <query>` | document **titles** | no |
| `affine doc content-search <query>` | document **bodies** | yes |

`doc search` reads workspace metadata over the websocket and matches titles.
`doc content-search` queries AFFiNE's `workspace.searchDocs` and returns the
matching block with a snippet:

```bash
$ affine doc content-search "quarterly forecast" --limit 5
{"ok":true,"tool":"search_doc_content","data":{"totalCount":1,"results":[
  {"docId":"WILb…","title":"Planning","highlight":"…the quarterly forecast held…",
   "blockId":"dxyQ…","updatedAt":"…","url":"…"}]}}
```

If the deployment has no indexer, this exits **5** with `indexer_disabled` and
an explanatory message rather than an empty result that looks like "no
matches". See `dev/README.md` for enabling it.

Either way the CLI only ever talks to AFFiNE — it holds no connection to
Manticore or Elasticsearch.

### Help

Help is generated from the same zod schemas that validate the call, so it
cannot drift from what a tool actually accepts.

```bash
affine --help                       # all groups and verbs
affine doc                          # verbs in one group
affine doc import --help            # one command: arguments, types, defaults
affine invoke append_markdown --help   # same, for any of the 92 tools
```

Help needs no configuration and no network — useful for exploring the surface
before credentials exist:

```bash
docker run --rm affine-cli:0.1.0 doc delete --help --human
```

Add `--json` (the default when stdout is not a TTY) to get help as structured
data. Mistyped commands and tool names come back with `didYouMean`, and failed
validation returns a `help` field naming the exact command to run.

### Flags

| Flag | Meaning |
|---|---|
| `-w, --workspace <id>` | workspace for this command |
| `--json` / `--human` | force a renderer (default: JSON unless stdout is a TTY) |
| `-y, --yes` | proceed with a destructive operation |
| `--profile <name>` | `full` (92) · `authoring` (66) · `read_only` (32) · `core` (29) |

## Output contract

stdout carries only the payload. Logs and diagnostics go to stderr, so
`… | jq` is always safe.

```jsonc
{ "ok": true,  "tool": "get_doc", "data": { … } }
{ "ok": false, "tool": "get_doc", "error": "…", "code": "doc_get_failed", "retryable": false }
```

Exit codes: `0` ok · `1` generic · `2` usage/config · `3` auth · `4` not found
· `5` permission or disabled by profile · `6` retryable · `7` confirmation required.

## Safety

Destructive tools are identified from upstream's own `destructiveHint`
annotation, not a hand-maintained list. They refuse to run without `--yes`,
exiting 7 — so an agent can never delete by omission. Passing `--yes` also
fills in the identifier-echo argument that upstream requires
(`confirmDocId`, `confirmWorkspaceId`, `confirmKey`).

For unattended agents, `--profile read_only` reduces the surface to 32 tools.

## Authentication

Each invocation is a separate process, so `AFFINE_EMAIL` + `AFFINE_PASSWORD`
means **one sign-in per command** — and AFFiNE rate-limits sign-in, returning
`429` after roughly a dozen rapid calls.

Sign in once instead:

```bash
affine login                     # prompts; or --email / --password
affine whoami                    # who the stored session belongs to
affine logout                    # discard it
```

The session cookie is written to `~/.config/affine-cli/credentials.json`
(`0600`, in a `0700` directory). **A password is never stored.** Override the
location with `AFFINE_CLI_HOME`.

Verified: 12 rapid invocations on a stored session, zero rate-limit failures.

### Precedence

Environment always wins, so behaviour stays predictable:

1. `AFFINE_API_TOKEN` — a JWT. **Not** an AFFiNE "MCP credential": those
   authenticate only AFFiNE's own MCP endpoint and are silently ignored here.
2. `AFFINE_COOKIE`
3. `AFFINE_EMAIL` + `AFFINE_PASSWORD` — signs in per command
4. the session saved by `affine login`

So after logging in, unset `AFFINE_PASSWORD` or the stored session is skipped.

A stored session is refused if it has expired or was issued by a different
`AFFINE_BASE_URL`.

### Silent anonymity

AFFiNE answers unauthenticated requests as an **anonymous caller** rather than
erroring, so bad credentials surface as empty results, not failures. `affine
whoami` is the check — it exits **3** with `not_authenticated` rather than
reporting a hollow success.

## Testing

```bash
npm test          # static + unit + CLI  (no AFFiNE, no network)
npm run test:e2e  # live, opt-in
```

| Suite | Count | What it covers |
|---|---|---|
| `test:static` | — | 92/92 harvest parity, verb→tool→schema mapping, 137 rendered help pages |
| `test:unit` | 23 | flag coercion, validation, JSON Schema, exit-code mapping, destructive gating, profiles, suggestions |
| `test:cli` | 21 | the real binary against a stub GraphQL server: output contract, every exit code, help without config |
| `test:e2e` | 8 | live AFFiNE: markdown round-trip, append, listing, confirmed delete, profile enforcement |

The e2e suite skips itself unless `AFFINE_E2E=1`, and works inside a throwaway
workspace it creates and deletes, so it never touches existing content:

```bash
AFFINE_E2E=1 AFFINE_BASE_URL=http://localhost:3010 \
  AFFINE_EMAIL=… AFFINE_PASSWORD=… npm run test:e2e
```

`Dockerfile.test` runs the offline suites inside the shipping image.

`test:static` is what catches upstream drift — run it after bumping
`affine-mcp-server`. It is what caught six wrong verb mappings during development.

## License

MIT — see [LICENSE](./LICENSE).

Builds on [affine-mcp-server](https://github.com/DAWNCR0W/affine-mcp-server)
(MIT), which provides the AFFiNE GraphQL/WebSocket implementation and the tool
catalog this CLI exposes. See [NOTICE](./NOTICE). Independent project, not
affiliated with AFFiNE.
