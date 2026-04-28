# What's New — 0.7.0 Asset Folder

The `WhatsNewModal` reads release-highlight images from
`apps/desktop/public/whatsnew/0.7.0/` so they ship inside the bundle
and work offline (no Cloudflare round-trip on first show).

## Filename contract

For each highlight whose `media.src` is `/whatsnew/0.7.0/<slug>` and
whose `media.themeAware` is `true`, drop in **two** files — one per
theme:

```
<slug>-light.webp
<slug>-dark.webp
```

If `themeAware` is `false`, a single `<slug>.webp` is enough. The modal
only ever requests `.webp`; converting from PNG is a one-liner with
`cwebp -q 80 in.png -o out.webp` (or any modern image tool).

## Format & sizing

| Field      | Recommendation                                                                                                                                        |
| ---------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container  | `webp` (lossy quality 80) — universally supported in the Tauri webview, ~30–40% smaller than PNG at the same perceived quality.                       |
| Aspect     | Match the highlight's declared `aspectRatio` (currently `16/9` for all 0.7.0 entries).                                                                |
| Resolution | `1600 x 900` minimum. The modal renders ~640px wide on a default sidebar layout, so 1600px gives us 2.5× pixel density without inflating bundle size. |
| File size  | < 200 KB per image. Run `cwebp -q 80` and review; bump quality only if compression artefacts appear in chrome-heavy UI shots.                         |

## Required slugs for 0.7.0

Five highlights declare a `media.src`; the streaming-reliability one
intentionally falls through to the gradient fallback (no asset needed).

| Slug                 | Surface to capture                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ai-chat-hub`        | **Settings → AI dialog** with at least two providers configured (one local — e.g. Ollama / LM Studio — and one cloud — e.g. OpenAI). Side-by-side with the right-rail chat panel open, showing: model pill in the composer, language flag dropdown, live token meter ticking against context window, and a streamed answer with the reasoning pill below it.                                                                                                                                         |
| `ai-surfaces`        | **Project · Why? button on a service card** with the **model-chooser popover open directly under the trigger** (multi-provider setup). The right rail visible on the right showing the auto-sent answer streaming in. Bonus points if the popover lists 3+ providers and the answer is mid-stream.                                                                                                                                                                                                   |
| `cve-analysis`       | **Per-CVE chat** opened from the sparkles icon on a single advisory in `ProjectDetailDrawer`. Show the five-section structured response: TL;DR, Where it bites, Worst case, Am I likely affected?, Fix. Use a real GHSA ID if possible (e.g. lodash, axios, transitive dep).                                                                                                                                                                                                                         |
| `multi-tab`          | **Right rail with 5 chat tabs** in the Cursor-style strip. At least one tab has the streaming dot indicator visible. Open the **History drawer** below to show 3–4 past conversations from the SQLite store with timestamps and model badges.                                                                                                                                                                                                                                                        |
| `dependency-hygiene` | **Dashboard** with a row of service cards showing: a freshness chip ("3h ago"), an audit chip with a `+2` delta badge, an outdated chip with a `-1` delta badge, and — in the dashboard header — the **"Rescan deps" button followed by the small amber "4 stale" pill**. The neighbouring **"Discover projects"** button (renamed from "Scan Projects") should also be visible to make the disambiguation legible. Bonus: capture one card mid-rescan with the Loader2 spinner + "scanning…" label. |

The sixth highlight (`streaming-reliability`) intentionally has no
`media.src` — it falls through to the gradient + bullet fallback.

## How to capture (concrete)

1. **Both themes**: app accepts `Cmd+Shift+L` to toggle theme. Capture
   each shot twice — once in light, once in dark.
2. **Window size**: resize to `1600 × 900` exactly via macOS Preview
   → Tools → Adjust Size, or use Rectangle (`Cmd+Option+→` then drag).
   Tauri windows are fine to capture larger and let the modal scale.
3. **Macro-friendly state**: prep at least one project with real CVEs
   (try `npm i lodash@4.17.20`), one project with a dirty git tree,
   and one stack of 5 chat tabs to make every shot dense.
4. **Convert to webp**:
   ```bash
   cwebp -q 80 ~/Downloads/ai-chat-hub-light.png \
     -o apps/desktop/public/whatsnew/0.7.0/ai-chat-hub-light.webp
   ```
   Or in bulk:
   ```bash
   for f in ~/Downloads/whatsnew-0.7.0/*.png; do
     cwebp -q 80 "$f" -o "apps/desktop/public/whatsnew/0.7.0/$(basename "${f%.png}").webp"
   done
   ```
5. **Visual check**: with assets in place, run `pnpm tauri:dev`, open
   Help → "What's new" to verify each slide picks up its image.

## Falling back gracefully

The modal handles missing assets silently:

1. If `media.src` is `undefined`, it renders the gradient + icon
   fallback declared in the highlight entry.
2. If a declared `<slug>-<theme>.webp` 404s, the `<img>`'s `onError`
   handler flips the same highlight back to its fallback.

That means **the release ships safely with no images at all** — drop
in screenshots whenever they're ready and they'll start surfacing on
the next render.
