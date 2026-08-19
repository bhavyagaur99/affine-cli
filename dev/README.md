# Development environment

A self-hosted AFFiNE for running the live test suite.

```bash
docker compose -f docker-compose.affine.yml up -d
```

Wait for `http://localhost:3010` to answer, then create the first admin — the
self-host setup route is undocumented, so for reference it is:

```bash
curl -X POST http://localhost:3010/api/setup/create-admin-user \
  -H 'content-type: application/json' \
  -d '{"name":"Admin","email":"admin@example.com","password":"<password>"}'
```

Then run the live suite against it:

```bash
AFFINE_E2E=1 AFFINE_BASE_URL=http://localhost:3010 \
  AFFINE_EMAIL=admin@example.com AFFINE_PASSWORD='<password>' \
  npm run test:e2e
```

The compose file leaves `AFFINE_INDEXER_ENABLED=false`, and that is fine: no
CLI tool uses the indexer. `search_docs` matches title substrings and
`find_doc_by_title` matches exact titles, both read from yjs workspace metadata
over the websocket. Neither searches body text, with or without an indexer —
verified by running Manticoresearch alongside and observing no change. See
"Search is title-only" in DESIGN.md.
