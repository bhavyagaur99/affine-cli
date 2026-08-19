# affine-cli for agents

AFFiNE is reachable by running a process. There is no MCP server to register.

## Discovery

```bash
affine tools list                  # 92 tools: name, title, readOnly, destructive
affine tools describe <tool>       # JSON Schema for that tool's arguments
affine <command> --help            # flags, types, defaults, required-ness
```

Do this instead of guessing arguments. Both `tools describe` and `--help` are
generated from the same schema that validates the call, so they cannot drift
from reality. Neither needs credentials or network access.

`--help` returns JSON when stdout is not a TTY:

```json
{"ok": true, "tool": "help", "data": {
  "command": "doc import", "tool": "create_doc_from_markdown",
  "positional": ["title"], "requiresYes": false,
  "flags": [{"flag": "--markdown", "type": "string", "required": true, "description": "…"}],
  "inputSchema": {…}
}}
```

## Recovering from a bad call

Usage errors (exit 2) carry the fix in the payload:

```json
{"ok": false, "error": "missing required --markdown", "code": "usage_error",
 "help": "affine doc import --help"}
{"ok": false, "error": "unknown tool \"apend_markdown\"", "code": "usage_error",
 "didYouMean": ["append_markdown"]}
```

Run the `help` command or take the `didYouMean` suggestion rather than retrying
the same call.

## Calling

Two equivalent forms. Prefer `invoke` — it covers every tool:

```bash
affine invoke export_doc_markdown --args '{"workspaceId":"WS","docId":"DOC"}'
affine invoke append_markdown --arg docId=DOC --arg markdown='## Notes'
affine doc export DOC -w WS        # curated shorthand, 45 of these
```

## Reading results

Output is JSON on stdout; logs are on stderr. Always branch on `ok`:

```json
{"ok": true,  "tool": "read_doc", "data": {…}}
{"ok": false, "tool": "read_doc", "error": "…", "code": "…", "retryable": false}
```

Exit codes are stable: `0` ok · `2` usage/config · `3` auth · `4` not found
· `5` permission · `6` retryable · `7` needs `--yes`.

Retry only on `6`. Codes `2`–`5` will not succeed on retry — fix the call.

## Destructive operations

Anything with `"destructive": true` in `tools list` exits `7` unless `--yes` is
passed. That is deliberate: it means an agent cannot delete something by
accident, only by intent.

If the task does not require writes, run with `--profile read_only`.

## Searching

Pick by what you are looking for:

```bash
affine doc search "Weekly Notes"          # titles; always available
affine doc content-search "forecast"      # body text; needs a server indexer
```

`content-search` returns `results[].highlight`, a plain-text snippet of the
matching block, plus its `docId` and `blockId`.

Exit **5** with `"code":"indexer_disabled"` means the deployment has no
server-side index — not that there are no matches. Fall back to `doc search`
rather than retrying. Zero matches is exit 0 with `totalCount: 0`.

## Setup

Required: `AFFINE_BASE_URL`, plus credentials. Optional: `AFFINE_WORKSPACE_ID`.

Prefer a stored session over email/password: every invocation is a new process,
so password auth signs in each time and AFFiNE rate-limits that (`429` after
roughly a dozen rapid calls).

```bash
affine login --email … --password …    # once
affine whoami                          # confirms; exit 3 if not authenticated
```

**Check `affine whoami` before real work.** AFFiNE answers unauthenticated
requests as an anonymous caller rather than erroring, so bad credentials look
like empty results rather than failures. `whoami` is the only reliable check —
exit 0 authenticated, exit 3 with `"code":"not_authenticated"` otherwise.

`affine doctor` reports the endpoint, resolved workspace, auth source, stored
session state, and confirms all 92 upstream tools were harvested.
