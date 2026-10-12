# Primary Lite

A lighter take on [Primary](https://github.com/primary-theme/obsidian) by Cecilia May for [Obsidian](https://obsidian.md). It keeps Primary's warm Classic Original palette but builds it on Obsidian's own CSS variables, with a handful of features on top. The aim is a theme that keeps working when Obsidian updates.

The full Primary theme (2.10.0 plus maintenance fixes) lives on the [`legacy`](../../tree/legacy) branch.

## Install

1. Create the folder `<vault>/.obsidian/themes/Primary Lite/`.
2. Put `theme.css` and `manifest.json` from this repository in it.
3. Choose **Primary Lite** in Settings → Appearance → Themes.

Most options need the [Style Settings](https://github.com/mgmeyers/obsidian-style-settings) plugin. Without it you get the palette, the fonts and the note cards.

## Fonts

Fonts are not bundled, which keeps `theme.css` small. The theme asks for:

- **[Interop](https://github.com/jhaemin/Interop)** (Inter with Noto Sans KR) for the interface and notes
- **[Cascadia Code](https://github.com/microsoft/cascadia-code)** for code, falling back to Interop for Hangul

Install them on your system, or load them from a CSS snippet with `@font-face` (base64 data URLs also work on mobile). A font picked in Settings → Appearance takes precedence over these.

Interop keeps Inter's character variants. Style Settings → Primary Lite → Typography switches them: single-storey a, l with a tail and alternate 1 are on by default, alternate r is off.

## Features

All of these are in Style Settings → Primary Lite.

| Section | Options |
|---|---|
| File Explorer → Folder Colors | Color folder names, icons, indentation guides, file names and backgrounds by folder. Six named colors you can adjust. |
| File Explorer → Icons | Open and closed folder icons in place of the collapse arrows, and icons for notes, bases, canvases and other files. Each icon can be replaced. |
| Editor | Plain, line grid or dot grid background, borders, file header that shows on hover, readable line width, line number colors, active line highlight |
| Ribbon | Docked or slide out on hover, background, border, roundness, width, icon size and spacing |
| Status Bar | On top, full length, slide up, slide out or floating; show everything, sync only or word count only; background, border, roundness, floating opacity |

On tablets, sidebars that are not pinned float as cards.

### Folder colors

Folders get colors from a CSS snippet, so a color stays with a folder when you add or reorder others. Start from [`snippets/folder-colors.css`](snippets/folder-colors.css):

```css
.nav-folder-title[data-path="Projects"],
.nav-folder-title[data-path="Projects"] ~ .nav-folder-children {
    --pl-folder-color: var(--pl-folder-blue);
}
```

The first selector colors the folder, the second passes the color to everything inside it.

### Custom icons

Style Settings can't upload files, so icons are pasted as text: `url("data:image/svg+xml,...")`. Encode an SVG with an SVG URL encoder such as [yoksel.github.io/url-encoder](https://yoksel.github.io/url-encoder/), or use a base64 data URL for a PNG. Icons are drawn as masks, so they take the text color and folder colors.

## Not included

Compared to Primary, Lite leaves out the custom icon set, alternate checkboxes, styles for community plugins (Calendar, Kanban, Style Settings' own UI), embedded fonts and the restyled components (tabs, buttons, menus, modals). Plugins that style themselves with Obsidian's variables still pick up the palette.

## Development

Requires [Node.js](https://nodejs.org/) (CI uses 22).

```
npm ci
npm run build    # write theme.css once
npm run dev      # rebuild on changes and copy to OBSIDIAN_PATH (see .env.example)
```

Sources are in `src/`: `scss/` for the styles (`_palette.scss` holds the colors), `style-settings.yaml` for the Style Settings options and `header.css` for the comment at the top of `theme.css`. Commit `theme.css` together with source changes; the Build workflow fails if it doesn't match the sources.

### Check for broken selectors

```
npm run audit:selectors
```

Downloads two official Obsidian builds, the baseline in `scripts/audit-selectors.config.json` and the latest release (or `--to <version>`), and reports theme classes, icons, attribute values and CSS variables that the newer build no longer has, plus class combinations Obsidian's own CSS stopped using, with their `src/scss` locations. `--verbose` lists informational sections too. Accept a reviewed finding by adding it to `ignore` in the config with a reason; once everything is fixed or ignored, raise `baseline` to the version you checked.

### Release

1. Update `version` in `manifest.json` (`x.y.z`). Only update `versions.json` when `minAppVersion` changes.
2. Commit, then push a tag that is exactly the version, without a `v`:

   ```
   git tag -a 0.1.1 -m "0.1.1"
   git push origin 0.1.1
   ```

3. The Release workflow checks the tag against `manifest.json`, checks that `theme.css` is up to date and creates a draft release with `manifest.json` and `theme.css`. Add notes and publish it.

## License and credits

[GPL-3.0](LICENSE), like Primary.

- Palette and features adapted from [Primary](https://github.com/primary-theme/obsidian) by Cecilia May
- Default icons from [Lucide](https://lucide.dev) (ISC License)
