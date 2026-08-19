# Development environment

A self-hosted AFFiNE for running the live test suite.

```bash
docker compose -f docker-compose.affine.yml up -d
```

Wait for `http://localhost:3010` to answer, then create the first admin. The
self-host setup route is undocumented, so for reference:

```bash
curl -X POST http://localhost:3010/api/setup/create-admin-user \
  -H 'content-type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"<password>"}'
```

Then run the live suite:

```bash
AFFINE_E2E=1 AFFINE_BASE_URL=http://localhost:3010 \
  AFFINE_EMAIL=admin@example.com AFFINE_PASSWORD='<password>' \
  npm run test:e2e
```

The stock compose file leaves `AFFINE_INDEXER_ENABLED=false`, which is fine for
the CLI — no tool among the 92 uses the indexer. See "Search is title-only" in
DESIGN.md.

## Optional: server-side full-text search

Only needed to experiment with AFFiNE's own `workspace.searchDocs` GraphQL
field, which *does* search body text. `docker-compose.search.yml` adds
Manticoresearch and enables the indexer:

```bash
docker compose -f docker-compose.affine.yml -f docker-compose.search.yml up -d
```

Verified from a clean volume on AFFiNE 0.27.4 with Manticore 29.0.2: the
migration creates the `doc` and `block` tables, documents index, and
`searchDocs(input: {keyword: "…"})` returns hits for words appearing only in a
document body.

Indexing is asynchronous and lands a few seconds after the write — a query
issued immediately returns nothing. Poll rather than assume:

```bash
docker exec affine_manticore mysql -h127.0.0.1 -P9306 -e 'SELECT COUNT(*) FROM block;'
```

### The one trap

**`AFFINE_INDEXER_*` must be set on `affine_migration`, not just `affine`.**

The `CreateIndexerTables` data migration runs in the migration container, and
it is what creates the two indices with correct field mappings. Configure only
the server and the migration logs:

```
No search provider found, skip creating tables
```

then the first write auto-creates indices with wrong types — ids land as
full-text fields instead of attributes — and every subsequent index job fails
with errors that point at the search engine rather than at your configuration.
On Elasticsearch that surfaces as `Fielddata is disabled on [doc_id]`; on
Manticore as `unknown table 'block'`. Both are the same missing env var.

The compose file here sets the block on both services via a YAML anchor, which
is the simplest way not to get this wrong.

### Backend choice

Elasticsearch also works (`AFFINE_INDEXER_SEARCH_PROVIDER=elasticsearch`,
endpoint `:9200`). Measured side by side on the same corpus:

| | Manticore | Elasticsearch 8.15 |
|---|---|---|
| Memory while indexing | 311 MiB | 1.60 GiB |
| Memory idle | 28 MiB | ~1.6 GiB (JVM keeps its heap) |
| Ready to serve | ~2 s | tens of seconds |
| Image | 928 MB | 1.96 GB |

Manticore is AFFiNE's configured default and is the better fit for a dev stack.
Elasticsearch earns its overhead only if you need clustering or its ecosystem.
