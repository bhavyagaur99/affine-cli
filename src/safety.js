// Destructive-op gating, derived from upstream metadata rather than a
// hand-maintained danger list (which would silently drift).
import { toolAnnotationsFor, createToolFilter } from "affine-mcp-server/dist/toolSurface.js";
import { LOCAL_TOOLS } from "./tools/contentSearch.js";

/** Tools that additionally require echoing back an identifier. */
export const CONFIRM_ECHO = {
  delete_doc: { confirmField: "confirmDocId", sourceField: "docId" },
  delete_workspace: { confirmField: "confirmWorkspaceId", sourceField: "id" },
  delete_blob: { confirmField: "confirmKey", sourceField: "key" },
  cleanup_blobs: { confirmField: "confirmWorkspaceId", sourceField: "workspaceId" },
};

/** Local tools are read-only queries; upstream has no annotations for them. */
const LOCAL_ANNOTATIONS = {
  readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: true,
};

export function annotations(tool) {
  if (LOCAL_TOOLS.has(tool)) return LOCAL_ANNOTATIONS;
  try { return toolAnnotationsFor(tool) || {}; } catch { return {}; }
}

export function isDestructive(tool) {
  return annotations(tool).destructiveHint === true;
}

export function isReadOnly(tool) {
  return annotations(tool).readOnlyHint === true;
}

export function profileFilter(profile) {
  const filter = createToolFilter({ AFFINE_TOOL_PROFILE: profile || "full" });
  const isEnabled = filter.isEnabled.bind(filter);
  return {
    ...filter,
    profile: filter.profile,
    // Read-only local tools are safe in every profile, including read_only.
    isEnabled: (name) => (LOCAL_TOOLS.has(name) ? true : isEnabled(name)),
  };
}

export class ConfirmationRequired extends Error {
  constructor(message) {
    super(message);
    this.name = "ConfirmationRequired";
    this.code = "needs_confirmation";
  }
}

/**
 * Gate a call. `--yes` satisfies the CLI gate and auto-fills the echo argument
 * upstream requires; without it, a non-interactive caller is refused.
 */
export function gate(tool, args, { yes }) {
  if (!isDestructive(tool)) return args;
  if (!yes) {
    throw new ConfirmationRequired(
      `${tool} is destructive. Re-run with --yes to proceed.`
    );
  }
  const echo = CONFIRM_ECHO[tool];
  if (echo && args[echo.confirmField] === undefined && args[echo.sourceField] !== undefined) {
    return { ...args, [echo.confirmField]: args[echo.sourceField] };
  }
  return args;
}
