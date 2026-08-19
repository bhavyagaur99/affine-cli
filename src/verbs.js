// Curated human-facing verbs. Data, not code — adding one is a table edit.
// Every tool remains reachable via `affine invoke <tool>` regardless.

export const VERBS = [
  // workspaces
  { path: ["ws", "list"],        tool: "list_workspaces",       summary: "List workspaces" },
  { path: ["ws", "get"],         tool: "get_workspace",         positional: ["id"], summary: "Show one workspace" },
  { path: ["ws", "create"],      tool: "create_workspace",      positional: ["name"], summary: "Create a workspace" },
  { path: ["ws", "delete"],      tool: "delete_workspace",      positional: ["id"], summary: "Delete a workspace" },
  { path: ["ws", "tree"],        tool: "list_workspace_tree",   summary: "Show the workspace document tree" },

  // documents
  { path: ["doc", "list"],       tool: "list_docs",             summary: "List documents" },
  { path: ["doc", "read"],       tool: "read_doc",              positional: ["docId"], summary: "Read a document" },
  { path: ["doc", "export"],     tool: "export_doc_markdown",   positional: ["docId"], summary: "Export a document as Markdown" },
  { path: ["doc", "search"],     tool: "search_docs",           positional: ["query"], summary: "Full-text search" },
  { path: ["doc", "find"],       tool: "find_doc_by_title",     positional: ["title"], summary: "Find a document by title" },
  { path: ["doc", "create"],     tool: "create_doc",            positional: ["title"], summary: "Create an empty document" },
  { path: ["doc", "import"],     tool: "create_doc_from_markdown", positional: ["title"], summary: "Create a document from Markdown" },
  { path: ["doc", "append"],     tool: "append_markdown",       positional: ["docId"], summary: "Append Markdown to a document" },
  { path: ["doc", "replace"],    tool: "replace_doc_with_markdown", positional: ["docId"], summary: "Replace document body" },
  { path: ["doc", "rename"],     tool: "update_doc_title",      positional: ["docId", "title"], summary: "Rename a document" },
  { path: ["doc", "move"],       tool: "move_doc",              positional: ["docId"], summary: "Move a document" },
  { path: ["doc", "delete"],     tool: "delete_doc",            positional: ["docId"], summary: "Delete a document" },
  { path: ["doc", "publish"],    tool: "publish_doc",           positional: ["docId"], summary: "Publish a document publicly" },
  { path: ["doc", "revoke"],     tool: "revoke_doc",            positional: ["docId"], summary: "Revoke public access" },
  { path: ["doc", "orphans"],    tool: "get_orphan_docs",       summary: "List documents outside the tree" },

  // tags / organisation
  { path: ["tag", "list"],       tool: "list_tags",             summary: "List tags" },
  { path: ["tag", "create"],     tool: "create_tag",            positional: ["tag"], summary: "Create a tag" },
  { path: ["tag", "add"],        tool: "add_tag_to_doc",        positional: ["docId", "tag"], summary: "Tag a document" },
  { path: ["tag", "remove"],     tool: "remove_tag_from_doc",   positional: ["docId", "tag"], summary: "Untag a document" },
  { path: ["tag", "docs"],       tool: "list_docs_by_tag",      positional: ["tag"], summary: "List documents with a tag" },
  { path: ["folder", "create"],  tool: "create_folder",         positional: ["name"], summary: "Create a folder" },
  { path: ["folder", "rename"],  tool: "rename_folder",         positional: ["folderId", "name"], summary: "Rename a folder" },
  { path: ["folder", "delete"],  tool: "delete_folder",         positional: ["folderId"], summary: "Delete a folder" },
  { path: ["folder", "list"],    tool: "list_organize_nodes",   summary: "List folder tree nodes" },

  // collections
  { path: ["collection", "list"],   tool: "list_collections",   summary: "List collections" },
  { path: ["collection", "create"], tool: "create_collection",  positional: ["name"], summary: "Create a collection" },
  { path: ["collection", "add"],    tool: "add_doc_to_collection", positional: ["collectionId", "docId"], summary: "Add a document" },

  // comments
  { path: ["comment", "list"],   tool: "list_comments",         positional: ["docId"], summary: "List comments" },
  { path: ["comment", "add"],    tool: "create_comment",        positional: ["docId"], summary: "Comment on a document" },
  { path: ["comment", "resolve"], tool: "resolve_comment",      positional: ["id"], summary: "Resolve a comment" },

  // database blocks
  { path: ["db", "columns"],     tool: "read_database_columns", positional: ["docId"], summary: "Read database columns" },
  { path: ["db", "cells"],       tool: "read_database_cells",   positional: ["docId"], summary: "Read database cells" },
  { path: ["db", "add-row"],     tool: "add_database_row",      positional: ["docId"], summary: "Add a database row" },

  // blobs
  { path: ["blob", "upload"],    tool: "upload_blob",           summary: "Upload a blob" },
  { path: ["blob", "delete"],    tool: "delete_blob",           positional: ["key"], summary: "Delete a blob" },

  // canvas
  { path: ["canvas", "get"],     tool: "get_edgeless_canvas",   positional: ["docId"], summary: "Read the edgeless canvas" },
  { path: ["canvas", "elements"], tool: "list_surface_elements", positional: ["docId"], summary: "List canvas elements" },

  // account / diagnostics
  { path: ["me"],                tool: "current_user",          summary: "Show the signed-in user" },
  { path: ["capabilities"],      tool: "get_capabilities",      summary: "Report server capabilities" },
  { path: ["notifications"],     tool: "list_notifications",    summary: "List notifications" },
];

export function findVerb(argv) {
  let best = null;
  for (const verb of VERBS) {
    if (verb.path.every((seg, i) => argv[i] === seg)) {
      if (!best || verb.path.length > best.path.length) best = verb;
    }
  }
  return best;
}
