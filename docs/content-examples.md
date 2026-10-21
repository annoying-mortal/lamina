# Starter content

The first deployment includes these editable, published demo records:

| Section | Example | Blank template |
| --- | --- | --- |
| Blog | Markdown Guide | Enter Title |
| Library / ACGN | 安达与岛村 | Enter Title |
| Library / Albums | To the Moon | Enter Title |
| Library / Books | 我与地坛 | Enter Title |
| Friends | Me → `http://localhost:8080/` | Enter Title → `https://example.com/` |

All entries have `demo: true`. Ratings are empty; sample dates are placeholders, not reading or listening history. Edit the entries in the CMS, or edit the Markdown and JSON files in `src/content/`. Remove the Demo flag after replacing an entry with your own content. `All` aggregates Library categories; `Others` starts empty.

The article source is `src/content/blog/markdown-guide.md`; the blank article is `src/content/blog/enter-title.md`. When copying an article, change its `id` and `slug` so each remains unique. The guide demonstrates this template's Markdown features, including local and remote images, syntax-highlighted code with language labels and copying, tables, tasks, footnotes, and math. Mermaid is intentionally excluded.

## Image sources

Library examples reference the following images directly over HTTPS. The remote artwork is not bundled with the template. Cover rights remain with the respective owners. If a remote host changes its URL or stops serving an image, replace the Cover URL in the CMS; Library retains a text fallback.

| Entry | Source page | Cover URL |
| --- | --- | --- |
| 安达与岛村 | [Penguin Books Australia — Adachi and Shimamura, Vol. 1](https://www.penguin.com.au/books/adachi-and-shimamura-light-novel-vol-1-9781645055358) | `https://cdn2.penguin.com.au/covers/400/9781645055358.jpg` |
| To the Moon | [Freebird Games — To the Moon OST](https://freebirdgames.bandcamp.com/album/to-the-moon-ost) | `https://f4.bcbits.com/img/a1974877315_5.jpg` |
| 我与地坛 | [新华一城书集 — 我与地坛](https://detail.youzan.com/show/goods?alias=2xk2jlaegm9uzdi&from_source=gbox_seo) | `https://img01.yzcdn.cn/upload_files/2024/08/13/FpZVWJoVqDKxqQlNIa6b8EgqvH-P.jpg!middle.jpg` |

The Markdown guide reuses the To the Moon cover for its remote-image example. Its local illustration is the template's own SVG at `public/images/markdown-example.svg`.
