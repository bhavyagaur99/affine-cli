// Content search — the one capability the upstream 92 tools do not cover.
//
// `search_docs` (upstream) matches titles read from yjs metadata. This queries
// AFFiNE's own `workspace.searchDocs` GraphQL field, which is backed by the
// server-side indexer and searches document *bodies*. Still a single hop to
// AFFiNE: the CLI never contacts Manticore or Elasticsearch itself.
import { z } from "zod";

const FEATURES_QUERY = `query ServerFeatures { serverConfig { features } }`;

const SEARCH_QUERY = `query SearchDocContent($workspaceId: String!, $keyword: String!, $limit: Int) {
  workspace(id: $workspaceId) {
    searchDocs(input: { keyword: $keyword, limit: $limit }) {
      docId
      blockId
      title
      highlight
      createdAt
      updatedAt
    }
  }
}`;

/** AFFiNE advertises the indexer in serverConfig.features only when enabled. */
export async function indexerEnabled(gql) {
  const data = await gql.request(FEATURES_QUERY, {});
  const features = data?.serverConfig?.features;
  return Array.isArray(features) && features.includes("Indexer");
}

export class IndexerDisabledError extends Error {
  constructor() {
    super(
      "Server-side search is not enabled on this AFFiNE deployment, so there is " +
      "nothing to search. Enable the indexer (AFFINE_INDEXER_ENABLED=true on both " +
      "the affine and affine_migration services), or use `affine doc search` for " +
      "title matching, which needs no indexer."
    );
    this.name = "IndexerDisabledError";
    this.code = "indexer_disabled";
  }
}

/** Strip the <b> markers AFFiNE wraps around matched terms. */
function plainHighlight(highlight) {
  if (typeof highlight !== "string") return null;
  return highlight.replace(/<\/?b>/g, "");
}

export function registerContentSearchTools(server, gql, defaults = {}) {
  const handler = async (parsed) => {
    const workspaceId = parsed.workspaceId || defaults.workspaceId;
    if (!workspaceId) {
      throw new Error("workspaceId is required. Provide it or set AFFINE_WORKSPACE_ID.");
    }
    const keyword = (parsed.keyword ?? "").trim();
    if (!keyword) throw new Error("keyword is required.");

    // Check first: without this the caller cannot tell "no matches" from
    // "this deployment cannot search".
    if (!(await indexerEnabled(gql))) throw new IndexerDisabledError();

    const limit = parsed.limit ?? 20;
    const data = await gql.request(SEARCH_QUERY, { workspaceId, keyword, limit });
    const hits = data?.workspace?.searchDocs ?? [];

    const baseUrl = (defaults.baseUrl || "").replace(/\/$/, "");
    // AFFiNE wraps matched terms in <b>; the markup is presentation noise in a
    // terminal and wasted context for an agent, so only the plain snippet ships.
    const results = hits.map((hit) => ({
      docId: hit.docId,
      title: hit.title,
      highlight: plainHighlight(hit.highlight),
      blockId: hit.blockId ?? null,
      updatedAt: hit.updatedAt ?? null,
      ...(baseUrl ? { url: `${baseUrl}/workspace/${workspaceId}/${hit.docId}` } : {}),
    }));

    return {
      workspaceId,
      keyword,
      limit,
      totalCount: results.length,
      truncated: results.length >= limit,
      results,
    };
  };

  server.registerTool(
    "search_doc_content",
    {
      title: "Search Document Content",
      description:
        "Full-text search across document bodies via AFFiNE's server-side indexer. " +
        "Returns matching blocks with highlighted snippets. " +
        "Unlike `search_docs` (which matches titles only and needs no indexer), this " +
        "requires the deployment to run an indexer and fails clearly when it does not. " +
        "Returns: { workspaceId, keyword, limit, totalCount, truncated, results: [{ docId, title, highlight, blockId, updatedAt, url }] }.",
      inputSchema: {
        workspaceId: z.string().optional().describe(
          "AFFiNE workspace id. Omit only when AFFINE_WORKSPACE_ID is configured."
        ),
        keyword: z.string().min(1).describe("Text to search for in document bodies."),
        limit: z.number().int().positive().max(100).optional().describe(
          "Maximum matches to return (default: 20, max: 100)."
        ),
      },
    },
    handler
  );
}

/** Tools this CLI adds on top of the upstream surface. */
export const LOCAL_TOOLS = new Set(["search_doc_content"]);
