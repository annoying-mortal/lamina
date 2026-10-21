# Font sources and redistribution

Verified on 2026-10-21. Keep the license files with the fonts when distributing
this template. These notes describe the exact files in this directory; a font
being downloadable for free does not by itself authorize web embedding.

## MiSans — original RhineLab UI typography

The archive array, extracted details, archive wordmark, 3D labels, CMS archive
preview, login wordmark and login session footer use MiSans for both English and
Chinese, matching the UI font stack in `RhineLabUI/src/style.css` and its canvas
label renderer.
The bundled MiSans 4.3.1 files provide weights 300, 400, 600 and 700. The original
fallback stack and `font-synthesis: none` are retained for those UI regions.

The reference project also has fixed “RHINE LAB” lettering drawn in Novecento
Sans Wide DemiBold. That artwork is specific to those words; it is not a
redistributable font for arbitrary site names. Editable site names in this
template use the original MiSans UI stack. A custom SVG logo can supply a
separately designed wordmark.

## Chogokuboso Gothic / 超極細ゴシック — retained reference asset

This earlier candidate is not used by the current site, archive or article font
stacks. Its source assets and notices remain available for reference.

- Creator/distributor: Line Font, now 糸 FONT.
- Official page: <https://font.websozai.jp/line-font-mihon.html>
- Original package: <https://font.websozai.jp/fontdata-8/chogokubosogothic.zip>
- Package SHA-256: `558e0b66dcc30795fc7b987fe7407358ac97acb4eca86d259fb9bceb810a4b42`
- Original font: `chogokuboso-gothic/chogokuboso-gothic.ttf`, version 1.00,
  family name `Chogokuboso Gothic`, Regular style.
- Browser font: `chogokuboso-gothic/chogokuboso-gothic.woff2`.
- Original notices: `chogokuboso-gothic/LICENSE_E`, `LICENSE_J`, `README_E`,
  and `README_J`, retained from the original package.

The official page explicitly permits commercial use, websites and
redistribution. The package includes the M+ FONTS PROJECT permissive license,
which permits commercial/noncommercial use, copying and distribution with or
without modification. This is the package's original license, not the SIL OFL.

The browser file was converted using FontTools without changing the outlines or
family name. The original contains 6,542 empty non-whitespace Unicode mappings,
including 5,495 empty CJK mappings. Those empty mappings were removed from the
WOFF2 so a browser can fall back to another font instead of rendering invisible
characters. The original TTF is preserved unchanged for provenance; use the
WOFF2 in CSS. Details and checksums are in
`chogokuboso-gothic/webfont-build.json`.

Actual nonempty CJK coverage is 6,709 characters. This Japanese-derived font is
not a complete Simplified or Traditional Chinese family. For example,
`请 经 历 链 录 码 设 测 试 歷` are missing. Keep a full CJK fallback such as
the already bundled MiSans after it. The thin design has one actual style;
additional weights are not included.

## Geom — site English typography

- Designer: Thanos Poulakidas.
- Project: <https://github.com/ThanosPoulakidas/Geom>
- Distribution: <https://github.com/google/fonts/tree/main/ofl/geom>
- Exact source: <https://raw.githubusercontent.com/google/fonts/main/ofl/geom/Geom%5Bwght%5D.ttf>
- Browser file: `geom/geom.woff2`, variable weight 300–900, normal style.
- Original source: `geom/original.ttf`, version 1.102.
- License: `geom/OFL.txt`, SIL Open Font License 1.1.
- Conversion and hashes: `geom/SOURCE.json`. Format conversion only; no outline,
  family-name or character-set edits.

The exact build has 516 glyphs and 499 Unicode mappings. It supports Latin,
extended Latin and Greek; it contains no Han characters. Geom replaces
Nasalization as the chosen site English font. Article text and RhineLab retain
their own independent stacks, defined in `public/typography.css`.

## Michroma — English comparison candidate

- Project: <https://github.com/googlefonts/Michroma-font>
- Distribution: <https://github.com/google/fonts/tree/main/ofl/michroma>
- Exact source: <https://raw.githubusercontent.com/google/fonts/main/ofl/michroma/Michroma-Regular.ttf>
- Browser file: `michroma/michroma.woff2`, weight 400, normal style.
- Original source: `michroma/original.ttf`.
- License: `michroma/OFL.txt`, SIL Open Font License 1.1.
- Original SHA-256: `b62301163788bc5b7f8fcac0b74b184e34e1827e577b499ecb724da065098f87`

Michroma is an independently named fallback with an extended technical shape;
it is not Nasalization. The WOFF2 is a format conversion with no outline edits.

## Montserrat — geometric comparison candidate

- Project: <https://github.com/JulietaUla/Montserrat>
- Distribution: <https://github.com/google/fonts/tree/main/ofl/montserrat>
- Exact source: <https://raw.githubusercontent.com/google/fonts/main/ofl/montserrat/Montserrat%5Bwght%5D.ttf>
- Browser file: `montserrat/montserrat.woff2`, variable weight 100–900,
  normal style.
- Original source: `montserrat/original.ttf`.
- License: `montserrat/OFL.txt`, SIL Open Font License 1.1.
- Original SHA-256: `0f7b311b2f3279e4eef9b2f968bcdbab6e28f4daeb1f049f4f278a902bcd82f7`

Montserrat is an independently named fallback; it is not Novecento Wide. The
WOFF2 is a format conversion with no outline edits. Neither bundled OFL license
declares a Reserved Font Name. Keep the original copyright and license notices;
the fonts must not be sold on their own.

## Oxanium — English comparison candidate

- Project: <https://github.com/sevmeyer/oxanium>
- Distribution: <https://github.com/google/fonts/tree/main/ofl/oxanium>
- Exact source: <https://raw.githubusercontent.com/google/fonts/main/ofl/oxanium/Oxanium%5Bwght%5D.ttf>
- Browser file: `oxanium/oxanium.woff2`, variable weight 200–800, normal style.
- Original source: `oxanium/oxanium.ttf`.
- License: `oxanium/OFL.txt`, SIL Open Font License 1.1; no Reserved Font Name
  is declared in the supplied license.
- Original SHA-256: `2ce01d946e1e1ffc8d7eecfffbda8623bedd63eaf811a20488c4b69af45babb0`

The WOFF2 is a format conversion with no outline or family-name edits. Keep the
original copyright and OFL license notices.

## Syncopate — English comparison candidate

- Distribution: <https://github.com/google/fonts/tree/main/apache/syncopate>
- Exact sources:
  <https://raw.githubusercontent.com/google/fonts/main/apache/syncopate/Syncopate-Regular.ttf>
  and <https://raw.githubusercontent.com/google/fonts/main/apache/syncopate/Syncopate-Bold.ttf>.
- Browser files: `syncopate/syncopate-regular.woff2` (400) and
  `syncopate/syncopate-bold.woff2` (700), normal style.
- Original sources: matching `.ttf` files in the same directory.
- License: `syncopate/LICENSE.txt`, Apache License 2.0, not SIL OFL.
- Original Regular SHA-256: `fcbb10798b80c981afabaa1055bde2ee29b283069b44cdfc68457e903a056ac1`
- Original Bold SHA-256: `c71f5a40a83115518443c13474e5132804f4a91ce26e26fd9718cd3814ad4b2e`

The WOFF2 files are format conversions with no outline or family-name edits.
Conversion notices are included in each webfont's description metadata and in
`syncopate/CONVERSION-NOTICE.txt`; original copyright metadata is retained. Keep
the license and notice files when redistributing them.

## Requested commercial families not bundled

### Novecento Sans Wide

- Author: Jan Tonellato / Synthview.
- Official family: <https://typography.synthview.com/novecento-sans-font-family.php>
- Current free-download EULA:
  <https://typography.synthview.com/pdf/eula-free-font-dafont.pdf>

The author offers free desktop styles, but the current free-download EULA
explicitly excludes conversion and web embedding and directs website users to
Fontspring, MyFonts or an Adobe/Monotype font service. A desktop font from that
package must not be copied into this reusable template as a webfont. No licensed
Novecento font file is included here.

### Nasalization

- Author: Ray Larabie / Typodermic.
- Official family: <https://typodermicfonts.com/nasalization/>
- License guidance: <https://typodermicfonts.com/license/>
- Free desktop terms: <https://typodermicfonts.com/desktop/>
- Webfont source: <https://www.myfonts.com/collections/nasalization-font-typodermic>

The current free desktop package does not grant live website embedding or
template redistribution rights. The author directs website users to a Webfont
license. Nasal, a different blurred derivative, appears in the public-domain
collection; that does not make Nasalization public domain. No Nasalization font
file is included here.

For either family, use an appropriately licensed webfont package and comply with
its domain, hosting and redistribution terms. A license for one deployed website
does not necessarily allow redistributing font binaries inside a public template.
Do not rename the included fallback families to impersonate these requested
fonts.

### Static comparison specimens

The original comparison specimens are complete, fixed PNG compositions rendered
locally from desktop fonts. `/type-study/` currently displays Novecento only;
the Nasalization image is retained as a reference asset. No original font software
is served, embedded, converted to a webfont, or included in the distribution.

- `/images/type-study/novecento-wide.png`: Novecento sans wide Normal v3.001,
  from the [author's download](https://www.dafont.com/novecento-sans.font).
  The included Synthview free-font EULA permits fixed-size graphics and
  words/phrases displayed on screen (Scope and Restrictions, page 1).
- `/images/type-study/nasalization.png`: Nasalization Regular v5.101,
  from the [author's download](https://www.dafont.com/nasalization.font).
  The included Typodermic Desktop EULA v260817, section 2.2, permits finished
  fixed images without font software or individually addressable glyphs.

Both images are rendered at 3× resolution, with the same text and nominal type
sizes used by the live candidate specimens. These image permissions do not grant
permission to use either original family as a live website font.

## Existing MiSans fallback

The previously bundled `misans-webfont-4.3.1` assets and `MiSans-license.pdf`
remain the RhineLab English family and fill Chinese characters absent from
Chogokuboso Gothic, FangYuan and the article stack. Their
existing notices and license remain unchanged.

## Earlier Chinese pairing specimens (reference assets)

The `type-study-chinese/` directory retains the earlier small Source Han Sans
and WenKai specimen subsets. They are not used by production typography.
`/type-study/#chinese` now displays the three applied site/archive/article stacks.

- Source Han Sans SC 2.005, Light 300 and Regular 400:
  <https://github.com/adobe-fonts/source-han-sans/releases/tag/2.005R>
- LXGW WenKai 1.530, Regular 400:
  <https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530>
- Both are SIL OFL 1.1. Original licenses are included in
  `type-study-chinese/`. Their preview subsets are renamed `Study Han Sans` and
  `Study WenKai`; original outlines and copyright notices are retained.
- `type-study-chinese/sources.json` records the exact sample, original hashes,
  full-font coverage, resulting subset hashes and sizes.

These are specimen-only WOFF2 subsets, not complete Chinese site fonts. The full
Source Han SC originals contain 44,853 Unicode mappings; full LXGW WenKai has
46,926. Both cover all 20,992 basic CJK ideographs and all 6,592 Extension A
ideographs, plus selected later extensions. Unicode mappings and glyph counts
are different measures; neither is a promise of every possible Chinese character.
Use a full, appropriately partitioned font when adopting one site-wide.

The MiSans preview uses the existing 4.003 split webfont, with 29,415 distinct
Unicode mappings in the Light shards. This differs from the current official
base package's advertised 29,608 characters. The official MiSans TC and L3 packs
are separate resources and are not included in this preview's count.

## Alimama FangYuan — site Chinese typography

- Official site: <https://www.alibabafonts.com/#/more>
- Official details and current license:
  <https://www.iconfont.cn/fonts/detail?cnid=pOvFIr086ADR>
- Runtime CSS: `alimama-fangyuan/fonts.css`, alias `Alimama FangYuan`.
- Local original: `alimama-fangyuan/alimama-fangyuan.woff2`, version 1.004 beta,
  downloaded byte-for-byte from the official font CDN. No conversion, subsetting,
  renaming or outline edits. Exact source, checksum and axes in `SOURCE.json`.
- Copyright Alimama / Alibaba (China) Co., Ltd.; current statement retained in
  `alimama-fangyuan/LICENSE.txt`.

This original has 6,763 basic Han characters and 7,017 Unicode mappings; it does
not cover all Simplified/Traditional Chinese. MiSans remains its missing-glyph
fallback. The weight axis spans 200–700; the square/round BEVL axis remains at
the source default 1. Geom precedes it in the CSS stack for English text.

The current license permits embedded use but restricts redistribution. The local
original font binary is excluded by `.gitignore` and `.dockerignore`; each
deployer must obtain their own unmodified copy. Compose mounts the directory
read-only into the frontend's `/var/www/site-fonts/alimama-fangyuan` and the CMS's
`/app/public/fonts/alimama-fangyuan`. Do not distribute the original font file or
personal published releases containing it as part of the reusable template.

## LXGW WenKai — article Chinese typography

- Official release: <https://github.com/lxgw/LxgwWenKai/releases/tag/v1.530>
- CSS: `lxgw-wenkai/fonts.css`, alias `LXGW WenKai`.
- Light 300, Regular 400 and Medium 500; every weight retains all 46,926 Unicode
  mappings from its full original, including all basic Han and Extension A.
- Each weight is divided into 94 Unicode-range WOFF2 shards so a page requests
  only what its text needs. These are full coverage fonts, not specimen subsets.
- Derivative internal family `Blog WenKai` avoids Reserved Font Names. Original
  outlines and copyright metadata remain. `lxgw-wenkai/OFL.txt` and `SOURCE.json`
  retain the license, upstream hashes, coverage and per-shard verification.

## JetBrains Mono — article English typography

- Exact requested package:
  <https://github.com/ryanoasis/nerd-fonts/releases/download/v3.5.1/JetBrainsMono.zip>
- JetBrains Mono 2.304 patched by Nerd Fonts 3.5.1; CSS alias `JetBrains Mono`.
- Runtime CSS: `jetbrains-mono/fonts.css`. Four weights (400/500/600/700), genuine
  normal and italic faces. The Nerd Font Mono variant preserves single-cell icons
  and programming ligatures. Every face retains all 12,226 Unicode mappings.
- WOFF2 format conversion only, no subsetting or outline edits. Exact publisher
  archive hash and per-face hashes are recorded in `jetbrains-mono/manifest.json`.
- Keep `OFL.txt`, `NERD-FONTS-LICENSE` and `UPSTREAM-README.md` with these files.

Article scope includes the post header, body, table of contents and adjacent
article navigation, plus CMS Markdown editing/preview. Global navigation/footer
and Blog index use site fonts. Explicit KaTeX fonts are not overridden.
