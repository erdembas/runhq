import type { HighlightMedia } from './types';

/**
 * Resolve a `HighlightMedia` declaration to a concrete URL.
 *
 * Three resolution paths, picked from `media.src`:
 *
 *   1. **Missing** — `media.src` is `undefined`. Returned `null`,
 *      which the renderer treats as "no visual at all"; the slide
 *      collapses to the content block defined by `fallback.bullets`
 *      (or hides the visual slot entirely on the modal).
 *
 *   2. **Absolute URL** — `media.src` matches `https?://…`. Returned
 *      verbatim. No extension is appended, no theme suffix is
 *      injected — what you wrote is what the `<img>` / `<video>`
 *      element receives. Used to host high-fidelity motion clips on
 *      a CDN (GitHub Releases, Cloudflare R2, Bunny, …) so the
 *      bundle stays lean while videos can ship at native 1080p
 *      VP9. The convention is to point at a stable URL whose
 *      lifetime matches the release tag — typically a GitHub
 *      Release asset, since those URLs are immutable per tag.
 *
 *   3. **Relative slug** — anything else. Treated as a path under
 *      `apps/desktop/public/whatsnew/<version>/`, with the
 *      extension derived from `media.kind` (`webp` for `image`,
 *      `webm` for `video`) and an optional `-light` / `-dark`
 *      suffix when `media.themeAware` is set. This is the path
 *      every release prior to 0.10.0 used and remains the default
 *      so existing entries keep working without a registry diff.
 *
 * Centralised here (rather than duplicated inside `WhatsNewModal`
 * and `ReleaseNotes`) so the absolute-URL bypass and the future
 * extensions live in one spot — both renderers always agree on
 * what URL they're rendering, and a fix to the resolver auto-
 * applies to the modal AND the archive page.
 */
export function resolveMediaSrc(
  media: HighlightMedia,
  themeSuffix: 'light' | 'dark',
): string | null {
  const src = media.src;
  if (!src) return null;
  // Absolute URL — bypass extension / theme machinery entirely.
  // The author has already committed to a fully-qualified URL,
  // so any further mangling would corrupt it (`https://cdn.example
  // .com/foo.webm` would become `…foo.webm.webm` if we appended
  // an extension, and a theme-aware absolute URL doesn't make
  // sense — the CDN doesn't know about light/dark variants).
  if (/^https?:\/\//i.test(src)) return src;

  const ext = media.kind === 'video' ? 'webm' : 'webp';
  if (media.themeAware) return `${src}-${themeSuffix}.${ext}`;
  return `${src}.${ext}`;
}
