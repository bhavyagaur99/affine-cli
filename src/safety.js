// Destructive-op gating, derived from upstream metadata rather than a
// hand-maintained danger list (which would silently drift).
import { toolAnnotationsFor, createToolFilter } from "affine-mcp-server/dist/toolSurface.js";

/** Tools that additionally require echoing back an identifier. */
export const CONFIRM_ECHO = {
  delete_doc: { confirmField: "confirmDocId", sourceField: "docId" },
  delete_workspace: { confirmField: "confirmWorkspaceId", sourceField: "id" },
  delete_blob: { confirmField: "confirmKey", sourceField: "key" },
  cleanup_blobs: { confirmField: "confirmWorkspaceId", sourceField: "workspaceId" },
};

export function annotations(tool) {
  try { return toolAnnotationsFor(tool) || {}; } catch { return {}; }
}

export function isDestructive(tool) {
  return annotations(tool).destructiveHint === true;
}

export function isReadOnly(tool) {
  return annotations(tool).readOnlyHint === true;
}

export function profileFilter(profile) {
  return createToolFilter({ AFFINE_TOOL_PROFILE: profile || "full" });
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
