// ---- Project DOCS ---------------------------------------------------------

/**
 * The "kind" classification produced by `runhq_core::docs::discover_docs`.
 * The frontend uses it to:
 *  - Pick an icon for the sub-nav entry.
 *  - Group entries by category in the dropdown.
 *  - Default-select the README on first open.
 */
export type DocKind =
  | 'readme'
  | 'changelog'
  | 'contributing'
  | 'architecture'
  | 'license'
  | 'doc'
  | 'other';

// ---- Per-project Notes ----------------------------------------------------

/**
 * One note file inside a service's notebook.
 *
 * `name` is the on-disk filename without the `.md` suffix and is
 * the stable key the IPC layer uses for read/write/delete. `title`
 * is the display string — the first H1 in the file when one exists,
 * otherwise the filename. Surface UIs should always render `title`
 * for user-visible spots and reach for `name` only when calling
 * back into IPC.
 */
export interface NoteFile {
  name: string;
  title: string;
  size_bytes: number;
  updated_at_ms: number;
}

export interface ProjectDoc {
  kind: DocKind;
  /**
   * Path relative to the service's cwd, with forward slashes
   * regardless of host OS. Stable identifier — used both as the
   * key for the sub-nav and as the `relative_path` parameter when
   * re-fetching the doc.
   */
  relative_path: string;
  /**
   * Display title surfaced in the sub-nav. Top-level docs use the
   * file name (`README.md`); `docs/...` entries use the full
   * relative path so users can disambiguate.
   */
  display_name: string;
  size_bytes: number;
  /** Last-modified time, milliseconds since UNIX epoch. */
  last_modified_ms: number;
}

export interface DocContent {
  relative_path: string;
  /**
   * Directory portion of `relative_path`. Used by the frontend
   * to resolve relative `<img src>` references and intra-doc
   * `[link](./other.md)` references.
   */
  base_dir: string;
  markdown: string;
  size_bytes: number;
  last_modified_ms: number;
}
