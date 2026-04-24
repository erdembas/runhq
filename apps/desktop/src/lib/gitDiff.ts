import type { FileDiff, FileDiffStatus } from '@/types';

export type FileEntry = FileDiff & { section: string };

/** VSCode-style single-letter status badges. */
export const statusLetter: Record<FileDiffStatus, string> = {
  added: 'A',
  modified: 'M',
  deleted: 'D',
  renamed: 'R',
  copied: 'C',
  untracked: 'U',
};

export const statusColor: Record<FileDiffStatus, string> = {
  added: 'text-emerald-400',
  modified: 'text-amber-400',
  deleted: 'text-rose-400',
  renamed: 'text-sky-400',
  copied: 'text-sky-400',
  untracked: 'text-emerald-300',
};

/**
 * Pill styling for the status badge. We pair a matching tinted background
 * with a ring so the letter stays legible on both light and dark surfaces —
 * a plain colored letter on a darkish sidebar was too easy to miss.
 */
export const statusBadgeBg: Record<FileDiffStatus, string> = {
  added: 'bg-emerald-400/20 ring-emerald-400/50 text-emerald-300',
  modified: 'bg-amber-400/20 ring-amber-400/50 text-amber-300',
  deleted: 'bg-rose-400/20 ring-rose-400/50 text-rose-300',
  renamed: 'bg-sky-400/20 ring-sky-400/50 text-sky-300',
  copied: 'bg-sky-400/20 ring-sky-400/50 text-sky-300',
  untracked: 'bg-emerald-300/20 ring-emerald-300/50 text-emerald-200',
};

/** Solid color used for the thin left-edge status rail on each file row. */
export const statusBarBg: Record<FileDiffStatus, string> = {
  added: 'bg-emerald-400',
  modified: 'bg-amber-400',
  deleted: 'bg-rose-400',
  renamed: 'bg-sky-400',
  copied: 'bg-sky-400',
  untracked: 'bg-emerald-300',
};

/**
 * Inline style palette for the right-edge status letter on every file row.
 * We use raw CSS values (not Tailwind utilities) because the original
 * `bg-{color}/15` approach proved fragile under Tailwind v4's JIT with
 * arbitrary opacity modifiers — the tint silently dropped in some dev
 * builds so the letter rendered over a transparent background and
 * disappeared into the row. An inline `rgba()` bypasses the toolchain
 * entirely and is guaranteed to paint.
 *
 * Colours match `statusColor` / `statusBarBg` (Tailwind palette):
 *   emerald-400 = 52 211 153
 *   amber-400   = 251 191 36
 *   rose-400    = 251 113 133
 *   sky-400     = 56 189 248
 *   emerald-300 = 110 231 183
 */
export const statusLetterStyle: Record<FileDiffStatus, { background: string; color: string }> = {
  added: { background: 'rgba(52, 211, 153, 0.18)', color: 'rgb(110, 231, 183)' },
  modified: { background: 'rgba(251, 191, 36, 0.18)', color: 'rgb(253, 224, 71)' },
  deleted: { background: 'rgba(251, 113, 133, 0.18)', color: 'rgb(253, 164, 175)' },
  renamed: { background: 'rgba(56, 189, 248, 0.18)', color: 'rgb(125, 211, 252)' },
  copied: { background: 'rgba(56, 189, 248, 0.18)', color: 'rgb(125, 211, 252)' },
  untracked: { background: 'rgba(110, 231, 183, 0.18)', color: 'rgb(167, 243, 208)' },
};

export const statusLabel: Record<FileDiffStatus, string> = {
  added: 'Added',
  modified: 'Modified',
  deleted: 'Deleted',
  renamed: 'Renamed',
  copied: 'Copied',
  untracked: 'Untracked',
};

const EXT_LANG_MAP: Record<string, string> = {
  ts: 'typescript',
  tsx: 'typescript',
  js: 'javascript',
  jsx: 'javascript',
  mjs: 'javascript',
  cjs: 'javascript',
  rs: 'rust',
  py: 'python',
  rb: 'ruby',
  go: 'go',
  java: 'java',
  kt: 'kotlin',
  scala: 'scala',
  css: 'css',
  scss: 'scss',
  less: 'less',
  html: 'html',
  xml: 'xml',
  svg: 'xml',
  json: 'json',
  yaml: 'yaml',
  yml: 'yaml',
  toml: 'ini',
  md: 'markdown',
  sql: 'sql',
  sh: 'shell',
  bash: 'shell',
  zsh: 'shell',
  dockerfile: 'dockerfile',
  makefile: 'makefile',
  graphql: 'graphql',
  vue: 'html',
  svelte: 'html',
  dart: 'dart',
  lua: 'lua',
  php: 'php',
  c: 'c',
  h: 'c',
  cpp: 'cpp',
  cc: 'cpp',
  cxx: 'cpp',
  hpp: 'cpp',
  cs: 'csharp',
  fs: 'fsharp',
  swift: 'swift',
  objc: 'objective-c',
  mm: 'objective-c',
  r: 'r',
  pl: 'perl',
  ex: 'elixir',
  exs: 'elixir',
  erl: 'erlang',
  hs: 'haskell',
  lhs: 'haskell',
  zig: 'zig',
  proto: 'protobuf',
};

export function languageForPath(path: string): string {
  const filename = path.split('/').pop() ?? '';
  if (filename === 'Dockerfile') return 'dockerfile';
  if (filename === 'Makefile') return 'makefile';
  if (filename === 'Cargo.toml' || filename === 'Cargo.lock') return 'toml';
  if (filename === '.gitignore' || filename === '.env') return 'ini';
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  return EXT_LANG_MAP[ext] ?? 'plaintext';
}

/**
 * Turn a raw unified diff into the left / right text blobs Monaco's
 * DiffEditor needs. We keep context lines on both sides so surrounding
 * code shows up unchanged, which is what users expect from a side-by-side
 * view.
 */
/**
 * Extract `original` / `modified` sides from git's unified-diff output.
 *
 * Everything before the first `@@` hunk is git bookkeeping (e.g.
 * `diff --git a/... b/...`, `index 6fdd3ef..cbf74e4 100644`,
 * `--- a/...`, `+++ b/...`, `similarity index`, `rename from/to`,
 * `new file mode`, `deleted file mode`, `Binary files differ`) — it
 * would clutter the editor if rendered as if it were source, so we
 * skip until we see the first hunk marker.
 *
 * Inside hunks we also drop the "\ No newline at end of file" marker,
 * which is diff metadata rather than actual content.
 */
export function parseUnifiedDiff(raw: string): { original: string; modified: string } {
  const originalLines: string[] = [];
  const modifiedLines: string[] = [];
  let inHunk = false;
  for (const line of raw.split('\n')) {
    if (!inHunk) {
      if (line.startsWith('@@')) inHunk = true;
      continue;
    }
    if (line.startsWith('@@')) continue;
    if (line.startsWith('\\ ')) continue;
    if (line.startsWith('-')) {
      originalLines.push(line.slice(1));
    } else if (line.startsWith('+')) {
      modifiedLines.push(line.slice(1));
    } else {
      const content = line.startsWith(' ') ? line.slice(1) : line;
      originalLines.push(content);
      modifiedLines.push(content);
    }
  }
  return { original: originalLines.join('\n'), modified: modifiedLines.join('\n') };
}

const BINARY_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tiff',
  'heic',
  'avif',
  'woff',
  'woff2',
  'ttf',
  'otf',
  'eot',
  'mp3',
  'mp4',
  'mov',
  'avi',
  'mkv',
  'webm',
  'wav',
  'flac',
  'ogg',
  'm4a',
  'zip',
  'tar',
  'gz',
  'tgz',
  'bz2',
  '7z',
  'rar',
  'xz',
  'lz4',
  'zst',
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'ppt',
  'pptx',
  'odt',
  'ods',
  'exe',
  'dll',
  'so',
  'dylib',
  'bin',
  'o',
  'a',
  'lib',
  'jar',
  'class',
  'wasm',
  'pyc',
  'pyo',
  'sqlite',
  'db',
  'sqlite3',
  'dat',
  'pkl',
  'npy',
  'parquet',
  'psd',
  'ai',
  'sketch',
  'fig',
]);

const IMAGE_EXTS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'bmp',
  'ico',
  'tiff',
  'heic',
  'avif',
]);

export function fileExt(path: string): string {
  const name = path.split('/').pop() ?? '';
  const dot = name.lastIndexOf('.');
  if (dot <= 0 || dot === name.length - 1) return '';
  return name.slice(dot + 1).toLowerCase();
}

export function isBinaryPath(path: string): boolean {
  return BINARY_EXTS.has(fileExt(path));
}

export function isImagePath(path: string): boolean {
  return IMAGE_EXTS.has(fileExt(path));
}

/**
 * Detect binary diffs by either the file extension (fast path) or by
 * spotting git's sentinel lines in the raw diff output.
 */
export function isBinaryDiff(raw: string, path: string): boolean {
  if (isBinaryPath(path)) return true;
  if (/^Binary files .* differ$/m.test(raw)) return true;
  if (/^GIT binary patch$/m.test(raw)) return true;
  return false;
}

export function humanKind(path: string): string {
  if (isImagePath(path)) return 'Image';
  const ext = fileExt(path);
  if (!ext) return 'Binary';
  return `${ext.toUpperCase()} file`;
}

// ---- Tree building --------------------------------------------------------

export type TreeNode = {
  name: string;
  fullPath: string;
  type: 'file' | 'folder';
  children: TreeNode[];
  file?: FileEntry;
  additions: number;
  deletions: number;
  fileCount: number;
  mixedStatus: boolean;
  status?: FileDiffStatus;
};

/**
 * Build a VSCode-style folder tree from a flat list of file diffs, with
 * "compact folders" applied — a single-child folder chain like `a/b/c`
 * collapses to one row so deep paths remain scannable.
 */
export function buildTree(files: FileEntry[]): TreeNode {
  const root: TreeNode = {
    name: '',
    fullPath: '',
    type: 'folder',
    children: [],
    additions: 0,
    deletions: 0,
    fileCount: 0,
    mixedStatus: false,
  };

  for (const file of files) {
    const parts = file.path.split('/').filter(Boolean);
    let node = root;
    node.additions += file.additions;
    node.deletions += file.deletions;
    node.fileCount += 1;
    if (node.fileCount === 1) {
      node.status = file.status;
    } else if (node.status !== file.status) {
      node.mixedStatus = true;
      node.status = undefined;
    }
    for (let i = 0; i < parts.length; i++) {
      const isLast = i === parts.length - 1;
      const name = parts[i] ?? '';
      const fullPath = parts.slice(0, i + 1).join('/');
      const nextType: 'file' | 'folder' = isLast ? 'file' : 'folder';
      let child: TreeNode | undefined = node.children.find(
        (c) => c.name === name && c.type === nextType,
      );
      if (!child) {
        const created: TreeNode = {
          name,
          fullPath,
          type: nextType,
          children: [],
          additions: 0,
          deletions: 0,
          fileCount: 0,
          mixedStatus: false,
        };
        if (isLast) {
          created.file = file;
          created.status = file.status;
        }
        node.children.push(created);
        child = created;
      }
      const cur: TreeNode = child;
      cur.additions += file.additions;
      cur.deletions += file.deletions;
      cur.fileCount += 1;
      if (cur.type === 'folder') {
        if (cur.fileCount === 1) {
          cur.status = file.status;
        } else if (cur.status !== file.status) {
          cur.mixedStatus = true;
          cur.status = undefined;
        }
      }
      node = cur;
    }
  }

  const sortChildren = (n: TreeNode) => {
    n.children.sort((a, b) => {
      if (a.type !== b.type) return a.type === 'folder' ? -1 : 1;
      return a.name.localeCompare(b.name);
    });
  };

  const compact = (n: TreeNode) => {
    if (n.type !== 'folder') return;
    for (const child of n.children) compact(child);
    sortChildren(n);
    if (n !== root) {
      while (n.children.length === 1) {
        const only = n.children[0];
        if (!only || only.type !== 'folder') break;
        n.name = `${n.name}/${only.name}`;
        n.fullPath = only.fullPath;
        n.children = only.children;
      }
    }
  };
  compact(root);
  return root;
}

export function collectFolderPaths(node: TreeNode, set: Set<string>): void {
  if (node.type === 'folder') {
    if (node.fullPath) set.add(node.fullPath);
    for (const child of node.children) collectFolderPaths(child, set);
  }
}

/** Human-friendly relative time, mirroring GitHub's "about 2 hours ago". */
export function timeAgo(ts: number): string {
  const now = Date.now() / 1000;
  const diff = Math.max(0, now - ts);
  if (diff < 60) return `${Math.floor(diff)}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;
  if (diff < 86400 * 30) return `${Math.floor(diff / 86400)}d ago`;
  if (diff < 86400 * 365) return `${Math.floor(diff / (86400 * 30))}mo ago`;
  return `${Math.floor(diff / (86400 * 365))}y ago`;
}

/** Pleasant deterministic hue for an author string. Used to color history avatars. */
export function authorHue(author: string): number {
  let h = 0;
  for (let i = 0; i < author.length; i++) {
    h = (h * 31 + author.charCodeAt(i)) | 0;
  }
  return Math.abs(h) % 360;
}

export function initialsFor(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length === 1) return (parts[0] ?? '?').slice(0, 2).toUpperCase();
  return ((parts[0]?.[0] ?? '') + (parts[parts.length - 1]?.[0] ?? '')).toUpperCase();
}
