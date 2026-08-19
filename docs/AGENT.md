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

## Setup

Required: `AFFINE_BASE_URL`, one of `AFFINE_API_TOKEN` / `AFFINE_COOKIE` /
(`AFFINE_EMAIL` + `AFFINE_PASSWORD`). Optional: `AFFINE_WORKSPACE_ID`.

Verify with `affine doctor` before real work — it reports the endpoint, the
resolved workspace, and confirms all 92 tools were harvested.
