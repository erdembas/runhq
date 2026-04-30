import { defaultSchema } from 'rehype-sanitize';
import type { Options as SanitizeOptions } from 'rehype-sanitize';

/**
 * HTML sanitisation schema for the project DOCS renderer.
 *
 * Why we need raw HTML at all
 * ---------------------------
 * Many real-world READMEs (Tauri, React, Next.js, every "centred
 * logo + badges" project on GitHub) ship blocks like:
 *
 * ```
 * <p align="center"><img src="docs/logo.png" width="128"></p>
 * <details><summary>Click to expand</summary> ... </details>
 * ```
 *
 * `react-markdown` strips raw HTML by default (security default).
 * Without raw-HTML support, our DOCS tab renders these blocks as
 * plain text — which the user spotted (`MD içinde HTML render
 * sorununu çözelim. github bunu render edebiliyor`).
 *
 * Why we sanitise aggressively
 * ----------------------------
 * Once we let HTML through, a hostile or just-careless README can
 * smuggle XSS into the renderer. RunHQ's webview has IPC access to
 * spawn processes, read the filesystem, and write to the user's
 * config — so an XSS bug here is not "an alert popping up" but a
 * full RCE on the user's machine. We start from
 * `rehype-sanitize`'s GitHub-derived `defaultSchema` and harden
 * further:
 *
 *   - Drop `style`, `link`, `meta`, `object`, `embed`, `iframe`,
 *     `form`, `input`, `button`, `select`, `textarea`, `script`,
 *     `noscript`. (Some are already absent from `defaultSchema`,
 *     listed here for documentation.)
 *   - Restrict `<a href>` protocols to http/https/mailto. No
 *     `javascript:`, no `file:`, no `vbscript:`.
 *   - Restrict `<img src>` protocols to http/https/data. The DOCS
 *     pipeline rewrites relative paths to `data:` URIs server-side
 *     anyway; we don't need to allow filesystem references.
 *   - Allow GitHub-style presentational attrs: `align` on
 *     paragraphs / divs / table cells / images, `width`/`height`
 *     on images, `target` + `rel` on links (the markdown
 *     components map already pins these).
 *   - Allow collapsible-section markup (`details`/`summary`) — a
 *     widely-used README pattern that reads gracefully when not
 *     supported and adds zero attack surface.
 *   - Allow `<picture>`/`<source>` for responsive logos that adapt
 *     to light/dark mode (GitHub's `prefers-color-scheme` pattern).
 *
 * Rejected categories live in `tagsToIgnore` / `excludedTags` —
 * `rehype-sanitize` drops anything not on the allow-list, so the
 * lists below are inclusive (whitelist). Adding a tag here is the
 * supported way to broaden support; do NOT bypass the schema by
 * dropping `rehype-sanitize` from the pipeline.
 */
export const DOCS_SANITIZE_SCHEMA: SanitizeOptions = {
  ...defaultSchema,
  // Tag-names. We start from the default GitHub list and add a
  // small set of presentational tags GitHub renders but
  // `rehype-sanitize` doesn't whitelist by default.
  tagNames: [
    ...(defaultSchema.tagNames ?? []),
    'details',
    'summary',
    'picture',
    'source',
    'mark',
    'kbd',
    'sub',
    'sup',
    'figure',
    'figcaption',
    'video',
    'audio',
    'track',
  ],
  attributes: {
    ...(defaultSchema.attributes ?? {}),
    // Wildcard — applies to every allow-listed tag. We keep
    // `className` (so syntax-highlighting + ToC anchors keep
    // working), `id` (for in-doc anchors), and `style` is
    // intentionally NOT here because inline styles are an
    // expression vector for `expression()`-style legacy IE
    // attacks and `background:url(javascript:…)` exploits in
    // older webviews.
    '*': [
      ...((defaultSchema.attributes?.['*'] as string[] | undefined) ?? []),
      'align',
      'lang',
      'dir',
      'role',
    ],
    img: [
      ...((defaultSchema.attributes?.img as string[] | undefined) ?? []),
      'alt',
      'src',
      'width',
      'height',
      'align',
      'loading',
      'srcset',
      'sizes',
    ],
    a: [
      ...((defaultSchema.attributes?.a as string[] | undefined) ?? []),
      'href',
      'title',
      'target',
      'rel',
    ],
    // GFM tables — `align` on cells controls left/center/right.
    th: [
      ...((defaultSchema.attributes?.th as string[] | undefined) ?? []),
      'align',
      'colspan',
      'rowspan',
      'scope',
    ],
    td: [
      ...((defaultSchema.attributes?.td as string[] | undefined) ?? []),
      'align',
      'colspan',
      'rowspan',
    ],
    // Collapsible sections.
    details: ['open'],
    summary: [],
    // Responsive picture / source — width/height/srcset/media
    // for the dark-mode logo trick.
    source: ['srcset', 'media', 'type', 'sizes', 'width', 'height'],
    // Code blocks — react-markdown adds `language-*` className,
    // already permitted via the wildcard above. No additional
    // attrs needed.
    code: [...((defaultSchema.attributes?.code as string[] | undefined) ?? [])],
    // Media: explicitly allow controls / loop / muted / poster but
    // NOT `autoplay` (UX courtesy — autoplay is an annoyance
    // vector even if not a security one).
    video: ['src', 'controls', 'loop', 'muted', 'poster', 'width', 'height'],
    audio: ['src', 'controls', 'loop', 'muted'],
    track: ['src', 'kind', 'srclang', 'label', 'default'],
  },
  protocols: {
    ...(defaultSchema.protocols ?? {}),
    href: ['http', 'https', 'mailto'],
    // `data:` allowed because our IPC-backed image resolver
    // already inlines local files as `data:` URIs and stops
    // anything outside the project tree at the Rust layer.
    src: ['http', 'https', 'data'],
    cite: ['http', 'https'],
  },
  // Strip every comment node. README authors don't ship
  // intentional HTML comments meant for end-users, and the
  // sanitiser's default behaviour preserves them — which means
  // `<!-- -->` chunks survive into the rendered DOM and look like
  // literal text in our codeblocks.
  allowComments: false,
};
