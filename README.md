# Lamina

A personal publishing template built with Astro, a Three.js archive, and a file-based CMS.

Introduce yourself, publish Markdown articles, and collect books, music, and other interests in an interactive glass archive. Content lives in ordinary Markdown and JSON files, editable from your editor or the built-in CMS.

## Features

- **Home and archive** — personal introduction, highlights, contact details, and a 3D archive with keyboard, mouse, and touch controls.
- **Blog** — categories, tags, drafts, search, table of contents, RSS, highlighted code with copy buttons, footnotes, and KaTeX mathematics.
- **Library and Friends** — collections with covers, ratings, notes, and related articles; friend links with avatars, labels, ordering, and visibility.
- **CMS** — Blog, Library, Friends, Media, Settings, and Backup, with English and Chinese interfaces and a live preview of site settings.
- **Appearance** — RhineLab-inspired light and dark themes, configurable branding, and separate typography for the site, archive, and articles.
- **Self-hosting** — a static frontend and single-administrator Node.js service, Docker deployment, and ZIP content migration. No external database.

## Quick start

Local development requires **Node.js 24+** and npm.

```sh
git clone https://github.com/annoying-mortal/lamina.git
cd lamina
npm ci
npm run dev
```

In a second terminal, from the same directory:

```sh
npm run admin
```

| Service | Address |
| --- | --- |
| Website | <http://127.0.0.1:4321/> |
| CMS | <http://127.0.0.1:4322/> |

Open the CMS to create your administrator account. Start in **Settings** to edit the site name, Home text, navigation, archive labels, contact details, and logo. CMS saves and local file edits update the development site.

The starter content includes a Markdown guide, sample Library entries, Friends links, and editable `Enter…` placeholders. Replace or delete these records and clear the Demo flag on your own content. See [starter content and image sources](docs/content-examples.md).

## Writing

Create a `.md` file under `src/content/blog/`, including in a subdirectory:

```md
---
title: My first post
date: 2026-01-01
tags: [notes]
draft: true
---

## A new beginning

Write your article here.
```

Set `draft: false` to publish. Drafts stay out of public pages, the archive, Blog lists, and RSS. New CMS posts start as drafts; handwritten posts without a `draft` field are public.

| Optional field | Default |
| --- | --- |
| `id`, `slug` | Derived from the relative file path |
| `summary` | Extracted from the body |
| `categoryId` | First configured Blog category |
| `tags` | Empty list |
| `readTime` | Estimated from the body |
| `draft`, `demo` | `false` |

Use explicit, unique IDs and slugs to keep addresses stable when moving files. `pubDate` and `description` are accepted as aliases for `date` and `summary`.

Upload images through **Media**, place files under `public/`, or use external HTTP(S) image URLs. For example, `public/images/photo.jpg` is referenced as `/images/photo.jpg`. Media uploads support PNG, JPEG, GIF, and WebP, up to **10 MiB each**. An existing SVG can be used as a logo through its URL.

The [Markdown Guide](src/content/blog/markdown-guide.md) demonstrates the supported formatting. The CMS provides a lightweight preview; article pages show the final typography and mathematics. See the [writing guide](docs/writing.md) (Chinese) for field rules, file editing, and publishing.

## Docker deployment

Requires Docker with the Compose plugin.

### CMS-managed content

```sh
docker compose up -d --build
```

The website runs at <http://localhost:8080/> and the CMS at <http://localhost:4322/>. Both ports bind to `127.0.0.1`.

Open the CMS setup page. If it asks for a setup token, retrieve it from the server terminal:

```sh
docker compose exec admin cat /app/.admin/setup-token
```

Enter the token and create your account. CMS saves automatically build and publish the site; a failed build keeps the last successful pages available. Uploaded files are served separately from page releases.

| Named volume | Stores |
| --- | --- |
| `blog-content` | Articles, settings, Library, Friends, and media index |
| `blog-uploads` | Uploaded images |
| `blog-published` | Built releases and the active `current` link |
| `blog-admin` | Administrator credentials and recovery snapshots |

Docker seeds articles and settings from [`admin/defaults/`](admin/defaults/README.md). In this mode, the running site uses its volumes rather than the host's `src/content/`.

After updating the source, run `docker compose up -d --build` again. Data volumes persist across rebuilds; `docker compose down -v` deletes them. Publishing logs are available with `docker compose logs -f admin`.

### Shared files with your editor

For a new installation that should use the host's content and uploads:

```sh
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

This mounts `./src/content/` and `./public/uploads/`, so the editor and CMS use the same files. Both kinds of edits trigger publication. Use both Compose files for subsequent commands.

`BLOG_CONTENT_DIR` and `BLOG_UPLOADS_DIR` can select other existing directories. On Linux, grant the container's default UID/GID `1000:1000` write access to these directories. To move an existing volume-based installation, follow the [folder migration guide](docs/writing.md#已有命名卷先导出再切换).

### Domain and access

Set the public website URL and host ports in a local `.env`:

```dotenv
SITE_URL=https://blog.example.com
PORT=8080
ADMIN_PORT=4322
```

Rebuild after changing `SITE_URL`. **Settings → Public URL** takes precedence for canonical and RSS URLs; use the same address if you fill it in. Point an HTTPS reverse proxy at the website's loopback port.

The CMS can remain private, accessed from your computer through an SSH tunnel:

```sh
ssh -N -L 4322:127.0.0.1:4322 user@your-server
```

Then open <http://localhost:4322/>. Public CMS hosting requires additional Host, HTTPS-cookie, and setup configuration; see [CMS runtime configuration](admin/README.md#运行配置).

## Backup and restore

In **Backup**, **Download ZIP** exports settings, posts (including drafts), Library, Friends, and supported images referenced by the content. Readable local images and downloadable remote images are bundled and deduplicated. Image references are rewritten inside the ZIP; unavailable images keep their original URLs with a warning.

To restore, select a backup, choose **Inspect ZIP**, review the contents, then confirm **Restore backup → Replace & restore**. Restoration replaces content and settings, preserves existing uploaded files and the administrator account, and saves a recovery snapshot first.

These are content backups. Unreferenced uploads, credentials, fonts, application code, and generated pages are outside the export. See [CMS backup documentation](admin/README.md#备份与恢复) for size limits and manual recovery.

## Typography

| Area | English | Chinese |
| --- | --- | --- |
| Site and CMS interface | Geom | Alimama FangYuan, falling back to MiSans |
| Archive UI, 3D labels, and archive/login wordmarks | MiSans | MiSans |
| Articles and CMS Markdown editor/preview | JetBrains Mono Nerd Font Mono | LXGW WenKai |

KaTeX uses its own math fonts. Font stacks are defined in [`public/typography.css`](public/typography.css); `/type-study/` displays them.

Alimama FangYuan is supplied separately. To use it, obtain the original font from its [recorded source](public/fonts/alimama-fangyuan/SOURCE.json) under the included [terms](public/fonts/alimama-fangyuan/LICENSE.txt) and place the WOFF2 at:

```text
public/fonts/alimama-fangyuan/alimama-fangyuan.woff2
```

The binary is excluded from Git and Docker build contexts; Compose mounts the font directory. Without it, Chinese site text uses MiSans. Full font provenance and notices are in [Font sources](public/fonts/FONT-SOURCES.md).

## Development

| Command | Purpose |
| --- | --- |
| `npm run dev` | Website development server, port 4321 |
| `npm run admin` | CMS, port 4322 |
| `npm run check` | Astro and TypeScript diagnostics |
| `npm run build` | Generate the static site in `dist/` |
| `npm run preview` | Serve `dist/` locally |
| `npm run verify` | Check built pages, links, RSS, and archive asset isolation |
| `npm test` | Run automated tests |
| `npm run publish` | Build, verify, and activate a local release in `.published/` |

Run `npm run build` before `npm run verify`. To deploy a standalone static frontend, serve the contents of `dist/`. `npm run publish` instead updates the `.published/current` link for an existing static server.

Local CMS auto-publishing is enabled with `ADMIN_AUTO_PUBLISH=1`; Compose enables it by default. `ADMIN_WATCH_CONTENT=0` turns off external-file watching while retaining publication after CMS saves.

```text
admin/             CMS server and interface
  defaults/        Starter content for new Docker installations
src/
  archive/         Three.js scene and interaction
  content/         Markdown posts and JSON settings/collections
  pages/           Astro routes
  components/      Site components
  styles/          Page styles and theme colors
public/            Models, fonts, images, and uploads
lib/               Shared content parsing and validation
scripts/           Initialization, publishing, and checks
nginx/             Static frontend configuration
docs/              Writing and starter-content guides
```

Site content in `src/content/` is versioned, except the generated media index. Uploads, credentials, environment files, and generated output are covered by [`.gitignore`](.gitignore). Update `admin/defaults/` when changing the examples supplied to new Docker installations.

## Credits and license

The archive scene and cassette model are adapted from [LBEILC/RhineLabUI](https://github.com/LBEILC/RhineLabUI); the upstream revision, MIT notice, and model attribution are recorded in [THREE-ATTRIBUTION.md](THREE-ATTRIBUTION.md). The homepage and writing workflow draw inspiration from [Nick Chen's blog](https://nickchen.top/) and [Astro Theme Hiro](https://github.com/nick-cjyx9/astro-theme-hiro).

Lamina has no project-wide license declared yet. Fonts and example artwork have their own notices, documented in [Font sources](public/fonts/FONT-SOURCES.md) and [Starter content](docs/content-examples.md).
