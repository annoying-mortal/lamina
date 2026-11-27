# Personal Blog (Lamina)

English | [简体中文](./README.zh-cn.md)

A self-hosted static personal blog, interactive 3D archive, collection library, and local content workspace built with **Astro 7.4**, **TypeScript**, **Three.js**, and **Node.js (>= 24)**.

It keeps Markdown and JSON files in `src/content/` as the single source of truth—no external database required—while providing a built-in single-admin CMS, portable ZIP backup/restore, and atomic static publishing with Nginx and Docker Compose.

## Features

- **Five-Section Home Page (`src/pages/index.astro`)**: Hero section with a scroll-reactive 12-hour dial (`HomeOrbit`), personal profile & highlights, interactive 3D archive, a 9-slot *About me* collection showcase, and contact details with a live uptime counter (`launchedAt`).
- **Interactive 3D Archive (`src/archive/`)**: Powered by lazily loaded Three.js (`archive-cassette.glb`, `InstancedMesh` grid, SSAO & Bokeh post-processing, theme wave transitions), combining blog posts, library entries, and visible friend links in one navigable 3D scene with full-site search (`/archive-search.json`). Isolated from `/blog/`, `/library/`, and `/friends/` so non-home pages never eagerly load 3D assets.
- **Markdown Blog & RSS (`src/pages/blog/`)**: Reads `src/content/blog/**/*.md` directly with dynamic categories, tags, reading-time estimation, Shiki light/dark syntax highlighting with copy controls, build-time KaTeX math rendering, H2/H3 table of contents, reading progress, and `/rss.xml`.
- **Library & Global Audio Player (`src/pages/library.astro`, `src/components/MusicPlayer.astro`)**: Tracks ACGN, Albums (with multi-track popover audio playback), Books, and Others, supporting filtering by type, tag, and track name with URL-hash-synced `<dialog>` modals.
- **Friends Directory & Applications (`src/pages/friends.astro`)**: Displays visible friend links with one-click site-info copying and an optional visitor application form (`POST /api/friend-applications`, with honeypot protection, origin checks, backend toggle enforcement, and per-IP rate limiting). Can be disabled via `PUBLIC_FRIEND_APPLICATIONS=0` or `friendApplicationsEnabled: false` in `site.json`.
- **Local Content Workspace (CMS) (`admin/`)**: Built-in Node.js admin server (`admin/server.mjs`) with EN / 中文 UI switching, `scrypt` authentication, CSRF/Origin checks, optimistic `revision` locking, streaming uploads (`/static/`, up to 256 MiB), reference-checked media deletion (`DELETE /api/media/:id`), and portable ZIP backup/restore with automatic rollback snapshot rotation.
- **Atomic Publishing (`scripts/publish.mjs`)**: Builds to an isolated staging directory, runs `verify.mjs`, preserves recent `_astro/` chunks for active browser tabs, and atomically flips `.published/current` (keeping the previous live release intact if a build or check fails).

## Requirements

- **Local Mode**: Node.js `>= 24.0.0`
- **Container Mode**: Docker and Docker Compose

## Quick Start

### Local Development

Install dependencies:

```sh
npm ci
```

Start the frontend and CMS in two terminals:

```sh
npm run dev
```

```sh
npm run admin
```

- **Frontend**: <http://127.0.0.1:4321/>
- **Admin CMS**: <http://127.0.0.1:4322/>

On first visit to the admin interface, set up the administrator username and password directly in the browser.

### Build, Test, Verify, and Atomic Publish

```sh
npm run check                        # Astro & TypeScript diagnostics (ASTRO_TELEMETRY_DISABLED=1)
npm test                             # Run Node unit & API boundary tests (tests/*.test.mjs)
npm run build                        # Build static site into dist/
npm run preview                      # Preview dist/ locally with upload headers & friend proxy
npm run verify                       # Full verification of dist/
node scripts/verify.mjs --quick      # Quick verification (core routes + sampled posts)
npm run publish                      # Build, quick-verify, and atomically update .published/current
```

For pure static hosting (e.g., GitHub Pages or Cloudflare Pages) where no admin backend is running to receive friend-link applications:

```sh
PUBLIC_FRIEND_APPLICATIONS=0 npm run build
```

### Docker Compose Deployment

Default named-volume mode (`blog-content`, `blog-uploads`, `blog-published`, `blog-admin`):

```sh
docker compose up -d --build
```

Host-directory bind-mount mode (read/write `./src/content/` and `./public/static/` directly on the host):

```sh
docker compose -f compose.yaml -f compose.files.yaml up -d --build
```

- **Frontend (read-only Nginx)**: <http://127.0.0.1:8080/> (or `http://localhost:${PORT}/` when `PORT` is customized)
- **Admin CMS**: <http://127.0.0.1:4322/>

When initializing the admin account inside Docker Compose, retrieve the one-time setup token from the host terminal:

```sh
docker compose exec admin cat /app/.admin/setup-token
```

## Configuration

### Site & Build Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8080` | Host port mapped to the `blog` Nginx service in `compose.yaml`. |
| `SITE_URL` | `http://localhost:${PORT:-8080}` (Compose) / `http://localhost:4321` (Astro) | Canonical site URL used during Astro build and origin checks. |
| `BUILD_OUTPUT_DIR` | `./dist` | Output directory for `astro build`, `preview`, and `verify.mjs`. |
| `SITE_PUBLISH_ROOT` | `./.published` (`/published` in Compose) | Root directory for atomic `releases/` and `current` symlink. |
| `SITE_UPLOADS_DIR` | `./public/static` (`/app/public/static` in Compose) | Upload storage directory. |
| `PUBLIC_FRIEND_APPLICATIONS` | `site.json` (`true`) | Set to `0` or `false` to disable the friend-link application form and `POST /api/friend-applications`. |
| `VERIFY_MODE` | `quick` in `publish.mjs`, `full` in `npm run verify` | Set `full` to force full-site HTML checks during `npm run publish`. |
| `VERIFY_SAMPLE_POSTS` | `3` | Number of latest post pages checked in `quick` verification mode. |
| `BLOG_CONTENT_DIR` / `BLOG_UPLOADS_DIR` | `./src/content` / `./public/static` | Host paths mounted by `compose.files.yaml`. |

### Admin & Proxy Variables

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_HOST` | `127.0.0.1` (`0.0.0.0` inside container) | Bind address for the CMS server. |
| `ADMIN_PORT` | `4322` | CMS server port. |
| `ADMIN_SITE_URL` | `SITE_URL` or `http://127.0.0.1:4321` | Frontend URL linked from the CMS. |
| `ADMIN_AUTO_PUBLISH` | Unset (`1` in Compose) | Set `1` to automatically run `scripts/publish.mjs` on CMS saves and watched file changes. |
| `ADMIN_WATCH_CONTENT` | Enabled with auto-publish | Set `0` to disable polling for external file changes. |
| `ADMIN_ALLOWED_HOSTS` | Loopback hosts for current port | Comma-separated list of additional allowed `Host` headers. |
| `ADMIN_AUTH_DIR` | `./.admin` (`/app/.admin` in Compose) | Private directory for credentials, backup rollback snapshots, and friend applications. |
| `ADMIN_LOOPBACK_PUBLISHED` | Unset (`1` in Compose) | Allows initial setup from Docker bridge with a terminal setup token. |
| `ADMIN_TRUST_PROXY_IP` | Unset (`1` in Compose) | Trusts `X-Real-IP` passed by Nginx for per-IP friend-application rate limiting. |
| `ADMIN_SECURE_COOKIES` | Unset | Set `1` when serving the CMS behind an HTTPS reverse proxy. |
| `ADMIN_ALLOW_REMOTE_SETUP` | Unset | Set `1` (with `ADMIN_SECURE_COOKIES=1`) to allow initial setup over HTTPS with a setup token. |

## Project Structure

```text
.
├── admin/                  # Local CMS server, auth, streaming media, backup & UI assets
├── docs/                   # Writing guide and starter content documentation
├── examples/               # Sample post template
├── lib/                    # Shared Node/Astro content, Markdown, and settings helpers
├── nginx/                  # Read-only Nginx runtime config
├── public/                 # Static assets, local fonts, 3D model, and uploads (/static/)
├── scripts/                # Initialization, atomic publish, verification, preview & dev proxy
├── src/
│   ├── archive/            # Three.js 3D archive scene and rendering modules
│   ├── components/         # Astro UI components (ArchiveSection, MusicPlayer, HomeOrbit, etc.)
│   ├── content/            # Markdown posts (blog/) and JSON data (site, library, friends)
│   ├── data/               # Typed site, library, and friends data loaders
│   ├── layouts/            # Base HTML layout and theme bootstrap
│   ├── lib/                # Content collection, search text & music player state helpers
│   ├── pages/              # Astro routes (/, /blog/, /library/, /friends/, /rss.xml, etc.)
│   ├── scripts/            # Client-side hydration & interactivity
│   └── styles/             # Stylesheets
├── tests/                  # Node test suites for admin security boundaries, parsers & backups
├── astro.config.mjs
├── compose.yaml
├── compose.files.yaml
└── Dockerfile
```

## Documentation

- [Writing & Deployment Guide (中文)](docs/writing.md)
- [Admin CMS & API Reference](admin/README.md) ([简体中文](admin/README.zh-cn.md))
- [Starter Content & Image Sources](docs/content-examples.md)
- [Font Sources & Licensing](public/fonts/FONT-SOURCES.md)
