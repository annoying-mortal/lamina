# JetBrains Mono for article text

Source: the user-selected [Nerd Fonts v3.5.1 JetBrainsMono.zip](https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.zip), containing JetBrains Mono 2.304.

The `JetBrainsMonoNerdFontMono` variant keeps both text and patched icons on a single monospace cell, making it suitable for article text, inline code and code blocks. The original programming ligatures are retained. Internal font names remain `JetBrainsMono NFM` / `JetBrainsMono Nerd Font Mono`; `JetBrains Mono` is the CSS family alias.

Included styles: 400, 500, 600 and 700, each with a genuine normal and italic face. The browser loads only styles actually used on the page. Each file is approximately 1.04 MiB. All 12,226 mapped Unicode codepoints and 10,610 private-use codepoints are retained; there is no CJK ideograph coverage. Normal faces contain 12,608 glyphs, italic faces 12,595.

The source TTF files were losslessly encoded as WOFF2 with FontTools 4.60.2. No subsetting, glyph editing or family renaming was performed. Source and WOFF2 cmap and glyph order were checked for equality. `manifest.json` records names, versions, file sizes and SHA-256 hashes. The downloaded ZIP hash matches the publisher's GitHub release-asset digest:

`fab782a66f7d3019da64f6572db9fc5d3a4bcb19f9fa13e2d8a62e3693d6396e`

## Licensing

These fonts are redistributed under SIL Open Font License 1.1. Keep `OFL.txt`, `NERD-FONTS-LICENSE` and `UPSTREAM-README.md` with the fonts. The original JetBrains copyright and embedded name-table notices are retained. The included JetBrains license declares no Reserved Font Names. The upstream README records the patched icon sets and their attribution links.

The conversion script and uncompressed source package are private build inputs under `.verification/jetbrains-font-research/`; they are not needed at runtime.
