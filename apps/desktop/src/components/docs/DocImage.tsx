import { useEffect, useState } from 'react';
import { ImageOff } from 'lucide-react';
import { ipc } from '@/lib/ipc';

interface DocImageProps {
  /** The service whose cwd anchors any relative path. */
  serviceId: string;
  /**
   * The doc's directory portion (matching `DocContent.base_dir`).
   * `''` treats the src as relative to the project root.
   */
  baseDir: string;
  /** The raw `<img src>` attribute as written in the markdown. */
  src: string | undefined;
  /** Forwarded to the rendered `<img>`. */
  alt?: string;
  /**
   * Honour `width=…` from raw HTML in the README. GitHub-style
   * `<img width="128">` is a frequent pattern (centred logos,
   * shield/badge rows). We accept either a number (`128`) or a
   * CSS-string (`128px`, `60%`) and feed it straight to the
   * underlying `<img>` so the layout matches what the README
   * author intended. We DO clamp via the same `max-h-[420px]`
   * cap that bare images respect — a malformed `width="9999"`
   * would otherwise blow the column width and force horizontal
   * scroll.
   */
  width?: string | number;
  /** Same intent as `width`, for vertical sizing. */
  height?: string | number;
  /**
   * `align` attribute (`left` / `right` / `center`). HTML4
   * presentational hint that GitHub still renders for backward
   * compat — applied here as a Tailwind float class so the
   * surrounding paragraph wraps cleanly. `center` collapses to
   * `mx-auto` because float-center isn't a thing.
   */
  align?: string;
}

/**
 * `<img>` replacement for the markdown renderer in the DOCS tab.
 *
 * Why a custom component:
 *   - The Tauri webview can render `data:` and `https:` URLs out of
 *     the box, but it cannot resolve `./assets/logo.png` against
 *     the project cwd — that's a filesystem path it has no view
 *     into.
 *   - Granting the renderer `fs:read` capability scoped to every
 *     possible cwd would be a security and configuration nightmare
 *     (capability scopes are static).
 *   - Inlining via `data:` URI keeps the rendering self-contained,
 *     gives us a clean place to enforce the size cap, and lets the
 *     backend's path-traversal guard do its job before any byte is
 *     read.
 *
 * Behaviour:
 *   - `data:` URIs render as-is.
 *   - Local paths and remote http(s) badges go through
 *     `ipc.resolveDocImage`, which returns a CSP-safe `data:` URI
 *     (or rejects with a precise error). On failure we render an
 *     inline broken-image placeholder so the page still flows
 *     naturally and the user can spot the offender.
 */
export function DocImage({ serviceId, baseDir, src, alt, width, height, align }: DocImageProps) {
  const [resolved, setResolved] = useState<string | null>(() => initialResolved(src));
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (!src) {
      setResolved(null);
      setFailed(true);
      return;
    }
    if (src.startsWith('data:')) {
      setResolved(src);
      setFailed(false);
      return;
    }
    let alive = true;
    setResolved(null);
    setFailed(false);
    ipc
      .resolveDocImage(serviceId, baseDir, src)
      .then((uri) => {
        if (!alive) return;
        setResolved(uri);
      })
      .catch((err) => {
        if (!alive) return;
        // Console-log the precise reason (size cap, traversal,
        // unrecognised mime) so debugging is one-click. Surface a
        // muted placeholder in the doc so the layout doesn't jump.
        console.warn(`docs: image "${src}" failed to load`, err);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [serviceId, baseDir, src]);

  if (failed || !resolved) {
    return (
      <span
        title={src ? `Couldn't load ${src}` : 'Missing image'}
        className="border-border/40 bg-surface-muted/40 text-fg-dim my-1 inline-flex items-center gap-1.5 rounded border px-2 py-1 align-middle text-[11px]"
      >
        <ImageOff className="h-3 w-3" />
        <span className="max-w-[280px] truncate font-mono">{src ?? 'image'}</span>
      </span>
    );
  }

  // README badge rows / centred logos rely on width / align hints.
  // Passing them as DOM attributes keeps the original GitHub
  // rendering intent intact; the alignment class is a small
  // adapter that maps HTML4 `align` to a Tailwind utility because
  // browsers apply `align="center"` only on top-level table cells.
  //
  // Why `inline-block` is the default
  // ---------------------------------
  // Tailwind v4 preflight resets every `<img>` to `display: block`
  // (per its own justification: "images should be block-level by
  // default"). That breaks the canonical GitHub badge row where a
  // README author writes
  //
  //   <p align="center">
  //     <img alt="license" src="…shields.io…">
  //     <img alt="ram"     src="…shields.io…">
  //     …
  //   </p>
  //
  // and expects the badges to sit on a single horizontal line,
  // centred together. With the preflight default, each `<img>` lands
  // on its own row and the page reads as a sad vertical badge stack.
  // GitHub's own renderer keeps `<img>` inline-replaced for exactly
  // this reason. We do the same: default to `inline-block` so badge
  // rows flow horizontally, lift to `block` only when the README
  // author explicitly asked for `align="center"` on a SINGLE-image
  // paragraph (where the centring matters more than inline flow).
  const alignClass = (() => {
    switch ((align ?? '').toLowerCase()) {
      case 'left':
        return 'inline-block mr-3 float-left';
      case 'right':
        return 'inline-block ml-3 float-right';
      // `align="center"` is intentionally NOT mapped to a class —
      // the parent `<p align="center">` (or any wrapper with
      // `text-align: center`) already centres inline-block
      // children. Forcing `display: block` here would re-introduce
      // the badge-stacking bug on the very pattern we just fixed.
      default:
        return 'inline-block align-middle';
    }
  })();

  return (
    <img
      src={resolved}
      alt={alt ?? ''}
      width={width}
      height={height}
      className={`border-border/40 my-1 max-h-[420px] max-w-full rounded border ${alignClass}`}
      loading="lazy"
    />
  );
}

/** Pre-fill with the src when it's already a directly-renderable URL. */
function initialResolved(src: string | undefined): string | null {
  if (!src) return null;
  if (src.startsWith('data:')) return src;
  return null;
}
