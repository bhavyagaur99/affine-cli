// Harvests the upstream tool surface into an in-process Map.
//
// The upstream registerXTools() functions only ever call `server.registerTool`.
// Passing a collector instead of an McpServer yields every handler as a plain
// async function. No MCP transport, no JSON-RPC, no subprocess.

const MODULES = [
  ["workspaces", "registerWorkspaceTools"],
  ["docs", "registerDocTools"],
  ["comments", "registerCommentTools"],
  ["history", "registerHistoryTools"],
  ["organize", "registerOrganizeTools"],
  ["properties", "registerPropertyTools"],
  ["icons", "registerIconTools"],
  ["user", "registerUserTools"],
  ["userCRUD", "registerUserCRUDTools"],
  ["auth", "registerAuthTools"],
  ["blobStorage", "registerBlobTools"],
  ["notifications", "registerNotificationTools"],
];

import { registerContentSearchTools, LOCAL_TOOLS } from "./tools/contentSearch.js";

const DIST = "affine-mcp-server/dist";

export async function buildRegistry({ gql, workspaceId, baseUrl }) {
  const registry = new Map();
  let source = "upstream";
  const collector = {
    registerTool(name, spec, handler) {
      registry.set(name, { name, spec, handler, source });
      return { name };
    },
  };

  for (const [file, fn] of MODULES) {
    const mod = await import(`${DIST}/tools/${file}.js`);
    const register = mod[fn];
    if (typeof register !== "function") {
      throw new Error(
        `Upstream export ${fn} missing from ${file}.js. ` +
        `affine-mcp-server changed shape; pin a working version.`
      );
    }
    if (fn === "registerAuthTools") register(collector, gql, baseUrl);
    else register(collector, gql, { workspaceId });
  }

  // Tools this CLI adds beyond the upstream surface.
  source = "local";
  registerContentSearchTools(collector, gql, { workspaceId, baseUrl });

  return registry;
}

export { LOCAL_TOOLS };

/** Fails loudly if upstream adds tools we never harvested. */
export async function assertManifestParity(registry) {
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);
  const manifest = require("affine-mcp-server/tool-manifest.json");
  const missing = manifest.tools.filter((t) => !registry.has(t));
  if (missing.length) {
    throw new Error(`Tool harvest incomplete; missing: ${missing.join(", ")}`);
  }
  return { expected: manifest.tools.length, harvested: registry.size };
}
