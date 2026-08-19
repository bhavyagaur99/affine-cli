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

Note `AFFINE_INDEXER_ENABLED=false` in the compose file: `search_docs` and
`find_doc_by_title` return nothing without the indexer. That is a property of
this dev stack, not of the CLI.
