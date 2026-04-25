# What's New — Asset Folder

The `WhatsNewModal` reads release-highlight images from
`apps/desktop/public/whatsnew/<version>/` so they ship inside the bundle
and work offline (no Cloudflare round-trip on first show).

## Filename contract

For each highlight whose `media.src` is `/whatsnew/0.6.0/<slug>` and whose
`media.themeAware` is `true`, drop in **two** files — one per theme:

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
| Aspect     | Match the highlight's declared `aspectRatio` (currently `16/9` for all 0.6.0 entries).                                                                |
| Resolution | `1600 x 900` minimum. The modal renders ~640px wide on a default sidebar layout, so 1600px gives us 2.5× pixel density without inflating bundle size. |
| File size  | < 200 KB per image. Run `cwebp -q 80` and review; bump quality only if compression artefacts appear in chrome-heavy UI shots.                         |

## Required slugs for 0.6.0

| Slug          | Surface to capture                                                                                                                                            |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `dashboard`   | Cross-Project Dashboard with at least 6 project cards (mix of dirty / clean / outdated / CVE indicators) and a visible Resource Heatmap band.                 |
| `diff-viewer` | Source Control window: file tree on the left (Changes section open with a few staged + unstaged files), Monaco diff filling the right, branch picker visible. |
| `timeline`    | Activity Timeline drawer open on the right edge with a node-graph cluster covering at least one full day of activity.                                         |

The fourth highlight (`plus-more`) intentionally has no `media.src` —
it falls through to the in-component gradient + icon fallback. If you
later want a real image there, give it `media.src: '/whatsnew/0.6.0/qol'`.

## Falling back gracefully

The modal handles missing assets silently:

1. If `media.src` is `undefined`, it renders the gradient + icon
   fallback declared in the highlight entry.
2. If a declared `<slug>-<theme>.webp` 404s, the `<img>`'s `onError`
   handler flips the same highlight back to its fallback.

That means **the feature ships safely with no images at all** — drop
in screenshots whenever they're ready and they'll start surfacing on
the next render.
