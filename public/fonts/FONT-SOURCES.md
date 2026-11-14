# Font sources and redistribution

The site uses five font families. LXGW WenKai loads from a fixed CDN package;
the other families are served locally. Keep each local family's copyright,
license and source records with its distributed files. Runtime stacks are defined in
[`../typography.css`](../typography.css). KaTeX supplies its own math fonts through
the application dependency.

## MiSans — archive UI and Chinese fallback

The archive array, extracted details, archive wordmark, 3D labels, CMS archive
preview, login wordmark and login session footer use MiSans for both English and
Chinese, matching the original RhineLabUI font stack. MiSans also supplies
missing Chinese glyphs for the site and article stacks.

- Upstream package: `misans-webfont` 4.3.1, font version 4.003.
- Weights: Light 300, Regular 400, DemiBold 600 and Bold 700; 753 WOFF2 shards.
- Runtime CSS: `../fonts.css`, with Unicode ranges for on-demand loading.
- Source, integrity and per-file hashes: `misans-webfont-4.3.1/source.json`.
- Original notices: `NOTICE.txt`, `MiSans-license.pdf` and
  `misans-webfont-4.3.1/UPSTREAM-README.md`.

The font binaries are copied unchanged from the recorded package. Copyright
and license notices remain in their original files. A custom SVG logo retains
its own designed lettering.

## Geom — site English typography

- Designer: Thanos Poulakidas.
- Project: <https://github.com/ThanosPoulakidas/Geom>
- Source: <https://raw.githubusercontent.com/google/fonts/main/ofl/geom/Geom%5Bwght%5D.ttf>
- Browser file: `geom/geom.woff2`, version 1.102, variable weight 300–900,
  normal style.
- License: `geom/OFL.txt`, SIL Open Font License 1.1.
- Conversion and original/browser hashes: `geom/SOURCE.json`.

The WOFF2 is a format conversion with no outline, family-name or character-set
changes. It retains 516 glyphs and 499 Unicode mappings for Latin, extended Latin
and Greek. The source TTF is not needed at runtime and is not bundled; its URL
and hash remain in the source record.

## Alimama FangYuan — site Chinese typography

- Official site: <https://www.alibabafonts.com/#/more>
- Official details: <https://www.iconfont.cn/fonts/detail?cnid=pOvFIr086ADR>
- Runtime CSS: `alimama-fangyuan/fonts.css`, alias `Alimama FangYuan`.
- Deployer-supplied file: `alimama-fangyuan/alimama-fangyuan.woff2`, version
  1.004 beta. Use the unmodified original; source, checksum and axes are recorded
  in `alimama-fangyuan/SOURCE.json`.
- Copyright Alimama / Alibaba (China) Co., Ltd.; the supplied terms are retained
  in `alimama-fangyuan/LICENSE.txt`.

This font has 6,763 basic Han characters and 7,017 Unicode mappings. MiSans is
its missing-glyph fallback. The weight axis spans 200–700; the square/round BEVL
axis remains at the source default 1. Geom precedes it for English text.

The recorded terms permit embedding but restrict redistribution. The original
binary is excluded by `.gitignore` and `.dockerignore`; each deployer obtains
their own copy. Compose mounts the directory read-only into both services.
Without the file, Chinese site text uses MiSans. Do not distribute the original
font or personal published releases containing it with the reusable template.

## LXGW WenKai — article Chinese typography

- Runtime stylesheet: <https://cdn.jsdelivr.net/npm/lxgw-wenkai-webfont@1.1.0/style.css>.
- Webfont package: `lxgw-wenkai-webfont`, maintained by Chawye Hsu.
- Original font: [LXGW WenKai](https://github.com/lxgw/LxgwWenKai) by lxgw,
  licensed under the SIL Open Font License 1.1.
- CSS family: `LXGW WenKai`, used for articles and CMS Markdown editing and preview.

The stylesheet and fonts load through jsDelivr with the package pinned to 1.1.0.
No local WenKai font files are bundled.

## JetBrains Mono — article English typography

- Source package: <https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.zip>
- JetBrains Mono 2.304 patched by Nerd Fonts 3.5.1; CSS alias `JetBrains Mono`.
- Runtime CSS: `jetbrains-mono/fonts.css`.
- Four weights, 400/500/600/700, with normal and italic faces. The Nerd Font Mono
  variant preserves single-cell icons and programming ligatures; each face
  retains all 12,226 Unicode mappings.
- Source and browser hashes: `jetbrains-mono/manifest.json`.
- Retained notices: `OFL.txt`, `NERD-FONTS-LICENSE` and `UPSTREAM-README.md`
  inside the same directory.

The files are WOFF2 format conversions without subsetting or outline edits.
Article typography covers the post title, body, table of contents and adjacent
article navigation, plus CMS Markdown editing and preview. Global navigation,
the footer and Blog index use the site stack. KaTeX fonts are not overridden.
