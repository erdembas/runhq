# What's New — 0.9.0 Asset Folder

The `WhatsNewModal` (and the parallel `ReleaseNotes` page) read
release-highlight media from `apps/desktop/public/whatsnew/0.9.0/` so
they ship inside the bundle and work offline (no Cloudflare round-trip
on first show).

0.9.0 is the first release that mixes **two media kinds** in the same
folder:

- **Static screenshots** — `.webp`, rendered as `<img>`. Default
  behaviour, identical to every release prior to 0.9.0 — entries in
  `data/0.9.0.tsx` that omit `media.kind` (or set it to `'image'`)
  pull `.webp` from this folder. Old `0.6.0` / `0.7.0` entries keep
  working unchanged.
- **Looping motion clips** — `.webm` (VP9 / Opus), rendered as
  `<video autoplay muted loop playsinline>`. Used for highlights
  whose value is in the _interaction_, not the end state — drag,
  type-as-you-go, expand / restore.

The chosen kind is declared on each highlight via `media.kind` in
`apps/desktop/src/lib/whatsnew/data/0.9.0.tsx`; the renderer picks the
extension and the DOM element from there.

## Theme convention for 0.9.0

Two different policies live side by side in this release on purpose:

- **Static highlights (`kind: 'image'`)** — **theme-aware**.
  `themeAware: true`, ship `<slug>-light.webp` + `<slug>-dark.webp`.
  Static screenshots compose against the modal chrome pixel-for-pixel,
  so a light screenshot in dark mode (or vice versa) looks like a
  rendering bug, not a stylistic choice.

- **Motion highlights (`kind: 'video'`)** — **dark-only by convention**.
  `themeAware: false`, ship a single `<slug>.webm`. Looping decorative
  clips read as embedded screen recordings (border + rounded chrome
  around the slot), so the dark→light edge against a light-mode modal
  frame plays as media-vs-page rather than mismatched UI. This is the
  same convention Linear, Stripe Press, Vercel changelog, and Raycast
  Store all use. It halves the encode work and the bundle for the
  motion subset, and keeps capture sessions sane.

The schema doesn't enforce this — `themeAware: true` still works for
videos if a future release ships a clip whose value _is_ the theme
contrast (e.g. demoing the theme-toggle itself). Keep the convention
unless you have a concrete reason to break it; mixing dark-only and
theme-aware clips inside a single modal makes the slide-to-slide loop
feel inconsistent.

## Filename contract

For a highlight whose `media.src` is `/whatsnew/0.9.0/<slug>`:

```
themeAware: true   →  <slug>-light.<ext>  +  <slug>-dark.<ext>
themeAware: false  →  <slug>.<ext>
```

…where `<ext>` is `webp` for `kind: 'image'` (or omitted) and `webm`
for `kind: 'video'`. The renderer never asks for a different
extension than the one declared in data.

## Required slugs for 0.9.0

| Slug                  | `kind`  | `themeAware` | Files to ship                                             | Surface to capture                                                                                                                                                                                                                                                                         |
| --------------------- | ------- | ------------ | --------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `tabbed-main-view`    | `video` | `false`      | `tabbed-main-view.webm`                                   | Main tab strip with Dashboard pinned at the leftmost slot. Right-click a service tab → **Pin** (it snaps left). Then grab another tab from the right edge and drag it past two siblings into the middle. End with the active tab streaming logs and an inactive tab visibly mid-keystroke. |
| `ai-commit-generator` | `video` | `false`      | `ai-commit-generator.webm`                                | `CommitPanel` with a small staged diff in the file list. Click the Sparkles button, pick a provider in `ModelChooserPopover`, and let the Conventional Commits message stream into the textarea word-by-word. Capture the full streaming arc — not just the final state.                   |
| `commit-language`     | `image` | `true`       | `commit-language-light.webp`, `commit-language-dark.webp` | Settings → AI dialog with a provider expanded, focus on the **Commit message language** picker open and showing 3+ language rows distinct from the chat-language picker above it. Static — the value here is the contrast between the two language settings, not motion.                   |
| `fullscreen-terminal` | `video` | `false`      | `fullscreen-terminal.webm`                                | A service tab in split layout with logs above and an embedded terminal below. Click **Expand** in the terminal toolbar — it should grow to fill the entire content area, then press **Esc** to collapse back. Two beats: expand, then restore. Keep the keyboard hint visible.             |
| `dashboard-search`    | `video` | `false`      | `dashboard-search.webm`                                   | Dashboard with at least 8 service cards visible. Press `/` so the input takes focus and the chip flashes, then type a 3–4 character query character-by-character; non-matching cards should disappear (display:none) leaving 2–3 surviving cards with live sparklines + ports.             |
| `sidebar-reorder`     | `video` | `false`      | `sidebar-reorder.webm`                                    | A populated section in the left rail (Services or Stacks). Pick up a row by its drag handle, move it across two siblings — the thin accent insertion line should follow the pointer, snapping above on top-half hover and below on bottom-half hover — and release to commit the order.    |

For the five video clips, **capture and encode against the dark
theme** — Settings → Appearance → Dark — so the looping motion reads
as an embedded screen recording in both light and dark modes of the
modal. The static `commit-language` highlight is the only entry that
needs both theme variants.

## Static images — `webp`

| Field      | Recommendation                                                                                                                                     |
| ---------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container  | `webp` (lossy quality 80) — universally supported in the Tauri webview, ~30–40% smaller than PNG at the same perceived quality.                    |
| Aspect     | Match the highlight's declared `aspectRatio` (currently `16/9` for every 0.9.0 entry).                                                             |
| Resolution | `1600 x 900` minimum. The modal renders ~640px wide on a default sidebar layout, so 1600px gives 2.5× pixel density without inflating bundle size. |
| File size  | < 200 KB per image. Run `cwebp -q 80` and review; bump quality only if compression artefacts appear in chrome-heavy UI shots.                      |

```bash
# PNG → WebP, theme-aware
cwebp -q 80 commit-language-light.png -o commit-language-light.webp
cwebp -q 80 commit-language-dark.png  -o commit-language-dark.webp
```

## Motion clips — `webm`

The renderer uses `<video autoplay muted loop playsinline preload="metadata">`.
That makes a few constraints non-negotiable:

- **No audio track.** Strip it during encode — keeps the file small,
  avoids any chance of an autoplay policy blocking the clip on
  WKWebView (macOS) or webkit2gtk (Linux).
- **Loop seamlessly.** The first and last frame should match;
  trim 1–2 frames at the cut so the loop doesn't visibly hitch.
  Aim for 3–6 second clips — any longer and the slot becomes a TV
  during browse, any shorter and the interaction never reads.
- **No mouse cursor in the recording** unless the cursor _is_ the
  story (drag, click). Hide it with the OS recorder's "hide cursor"
  toggle for the typing / animated clips.

| Field      | Recommendation                                                                                                                                                                                            |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container  | `webm` with VP9 video. Supported in WKWebView (macOS Safari 14+), webkit2gtk (Linux), and WebView2 (Windows). If a future webview can't play it, the modal's `onError` falls back to the splash gradient. |
| Codec      | VP9, CRF 33–36 for chrome-heavy UI shots (text stays crisp). Drop to CRF 30 only if you see banding on dark gradients.                                                                                    |
| Aspect     | Match the highlight's declared `aspectRatio` (currently `16/9` for every 0.9.0 entry).                                                                                                                    |
| Resolution | `1600 x 900` capture, encoded at `1280 x 720` to keep the bundle lean — 2× the modal's natural width is plenty for sharp playback.                                                                        |
| Duration   | 3–6 s. Anything longer becomes background TV during browse.                                                                                                                                               |
| Framerate  | 24 fps for typing / streaming clips, 30 fps for drag interactions where pointer easing matters.                                                                                                           |
| File size  | < 350 KB per clip. Five clips × dark-only at this budget keeps the 0.9.0 motion bundle under ~1.75 MB total — half what theme-aware would have cost.                                                      |

```bash
# Capture (macOS): use the built-in screenshot tool (Cmd+Shift+5 → Record)
# or the OBS / Screenflick of your choice. Hide the cursor for the typing
# / animated clips; keep it visible for drag clips. Make sure the app is
# in DARK theme — videos in 0.9.0 ship dark-only by convention.

# MP4/MOV → WebM (VP9, no audio, looping). Run once per clip; the output
# filename matches the slug exactly (no -light / -dark suffix).
ffmpeg \
  -i tabbed-main-view.mov \
  -an \
  -c:v libvpx-vp9 \
  -crf 34 \
  -b:v 0 \
  -row-mt 1 \
  -tile-columns 2 \
  -frame-parallel 1 \
  -pix_fmt yuv420p \
  -vf "scale=1280:720" \
  tabbed-main-view.webm
```

After encoding, sanity-check sizes:

```bash
du -h public/whatsnew/0.9.0/*.webm | sort -h
```

If a clip exceeds the budget, raise `-crf` by 2 first; if the visible
quality drops, scale to `960:540` instead — it's a 16:9 thumbnail in
the modal, so 540p still looks crisp.

## Falling back gracefully

If a file is missing or fails to decode, both the modal and the
release-notes page swap in the in-component splash (gradient + Lucide
icon + caption) defined under `fallback` in `data/0.9.0.tsx`. That
means:

- We can ship a partial set on day one without empty rectangles.
- A single corrupt file never breaks the modal — only that one slot
  falls back.
- Switching a highlight from `kind: 'video'` back to `'image'` (or
  vice versa) is a one-line change in data; existing files for the
  other extension are simply ignored until that line is flipped.
