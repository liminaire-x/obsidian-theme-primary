# Primary Lite

Obsidian theme. A lighter take on Primary by Cecilia May: Primary's palette on Obsidian's own CSS variables plus a few features configured through the Style Settings plugin. Personal fork; GPL-3.0.

- `main`: Primary Lite (`manifest.json` name "Primary Lite")
- `legacy`: the full Primary 2.10.0 theme with maintenance fixes (Grunt build, `src/css` + `src/scss`)
- tag `2.10.0`: the original upstream 2.10.0 commit

## Layout

- `src/scss/index.scss` imports the partials:
  - `_palette.scss`: colors and sizes. Generated once from Primary's palette, keeping only variables Obsidian reads or the features use; now edited by hand
  - `_fonts.scss`, `_editor.scss`, `_properties.scss`, `_file-explorer.scss`, `_ribbon.scss`, `_status-bar.scss`, `_mobile.scss`: one feature each
- `src/style-settings.yaml`: Style Settings options, appended to `theme.css` inside `/* @settings */`
- `src/header.css`: comment at the top of `theme.css`
- `theme.css`: build output, committed (Obsidian installs it from the repo/release)
- `snippets/folder-colors.css`: example snippet; folder colors are assigned per folder by users
- `scripts/`: `build.js`, `preview.js`, `audit-selectors.js` (+ `audit-selectors.config.json`)

## Commands

```
npm ci
npm run build             # src → theme.css (commit theme.css with source changes; CI checks it)
npm run dev               # rebuild on change, copy to OBSIDIAN_PATH from .env
npm run preview -- ...    # screenshot the real Obsidian app with this theme (see below)
npm run audit:selectors   # find selectors/variables a newer Obsidian no longer has
```

## Checking changes visually

`npm run preview` runs the real Obsidian desktop app on a sample vault in `.cache/preview` and saves a PNG (first run downloads Obsidian, Electron, @electron/remote and playwright-core into `.cache/preview`; on Linux without a display it uses `xvfb-run`). Read the PNG to look at the result.

```
npm run preview -- --out .cache/preview/light.png
npm run preview -- --dark --snippet snippets/folder-colors.css --class sb-style-floating
npm run preview -- --mobile --width 1180 --height 820    # tablet emulation
npm run preview -- --eval "getComputedStyle(document.body).getPropertyValue('--font-weight')"
npm run preview -- --open Highlights.md --click ".cm-highlight-orange:not(.cm-formatting)" --click ".cm-highlight-color-widget .highlight-swatch"
npm run preview -- --no-theme ...                        # Obsidian's default theme, to tell theme bugs from app behavior
```

`--hover` and `--click` use the real mouse, in order, before `--eval`. Each run starts from a fresh layout with the note in editing mode.

Style Settings classes that default to on are added to `<body>` automatically (`--no-defaults` to skip). Pretendard and Cascadia Code aren't installed in the preview, so pass a font snippet with `--snippet` when checking typography. The Settings window doesn't render in the preview.

## Conventions

- Prefer overriding Obsidian's CSS variables (under `body`, `.theme-light`, `.theme-dark`) over styling elements. Keep selectors short and avoid `!important` and `:has()`, per Obsidian's theme guidelines.
- Obsidian renamed side classes: the ribbon has `mod-left` in 1.6 and `mod-primary` in 1.14, so ribbon rules target both. Drawers and sidebar splits get both old and new classes from Obsidian's `mod-{side}` template.
- Style Settings: toggles are `class-toggle` (body classes, need the plugin); values the theme must have without the plugin are CSS variables with defaults in SCSS. Keep YAML defaults equal to the CSS defaults; resolve colors with `npm run preview -- --eval` rather than guessing.
- Fonts are not bundled. Latin uses Inter (bundled with Obsidian 1.14 as "Inter", variable); Hangul uses Pretendard Variable; Interop is a fallback. Weights follow Primary: 450 text, bold = weight + 200.
- Icons are CSS masks from `url("data:image/svg+xml,...")` variables; defaults are Lucide (ISC).
- Indent with 4 spaces, LF line endings.

## After an Obsidian update

1. `npm run audit:selectors` (also runs weekly in the Selector Audit workflow).
2. Fix findings, or add reviewed ones to `ignore` in `scripts/audit-selectors.config.json` with a reason.
3. Check with `npm run preview`, then raise `baseline` in the config to the checked version.

## Release

Bump `version` in `manifest.json`, commit, push a tag equal to the version (no `v`). The Release workflow checks the tag and `theme.css`, then drafts a GitHub release with `manifest.json` and `theme.css`. Only update `versions.json` when `minAppVersion` changes.
