# Local Content Workspace (CMS)

English | [简体中文](./README.zh-cn.md)

Start the frontend and admin workspace in two separate terminals from the project root:

```sh
npm run dev
```

```sh
npm run admin
```

The frontend runs at <http://127.0.0.1:4321/> and the admin workspace runs at <http://127.0.0.1:4322/>. The workspace reads and writes project content directly, and the Astro dev server picks up saved changes automatically. In Docker Compose mode, the frontend defaults to port `8080` while the admin remains on `4322`.

Local editors and the CMS share the exact same Markdown files under `src/content/blog/`. After adding a `.md` file locally, refresh the post list in the CMS to keep editing it—no database import is needed. See the [Writing Guide](../docs/writing.md) for minimal post fields, defaults, images, and deployment details.

The CMS UI defaults to English and can be switched between **EN / 中文** from the top-right toggle; user-authored site copy, posts, and tags remain as written.

## Administrator Sign-In

Visiting `/` or `/login` for the first time shows the identity initialization page where you choose the administrator username and password. Usernames must be 3–32 characters using ASCII letters, digits, dots, underscores, or hyphens, starting with a letter or digit (case-sensitive). There is no default password and none is generated automatically. Passwords must be 8–128 characters and include at least one digit, one uppercase letter, and one lowercase letter; Chinese characters, symbols, and spaces are allowed without trimming leading/trailing spaces. After initialization, the same page verifies both username and password.

This is a single-administrator workspace. Legacy `admin` credentials remain compatible and can be renamed after login via **Account** in the top-right bar. Updating account settings requires the current password; leaving the new password blank updates only the username, while setting a new password requires confirmation. Saving rotates the active session and CSRF token and invalidates all other signed-in sessions. The account dialog is isolated from the post editor, so passwords never enter unsaved-draft recovery storage.

Passwords are stored as `scrypt` hashes (`N=32768`, `r=8`, `p=1`) with a random salt in `.admin/auth.json` (mode `0600`), excluded from Git and Docker build contexts. In Compose, the dedicated `blog-admin` volume is mounted at `/app/.admin` and is never exposed by Nginx.

Signed-in sessions use `HttpOnly`, `SameSite=Strict` cookies valid for up to 12 hours in server memory; signing out, expiring, or restarting the server ends the session. Pre-login bootstrap CSRF tokens are separate from post-login session tokens. Failed sign-in attempts return a uniform error and are rate-limited to 6 attempts per source every 15 minutes (plus a global cap); successful login clears the counter.

Initial setup accepts loopback requests by default; for HTTPS remote setup see [Runtime Configuration](#runtime-configuration). Docker Compose explicitly sets `ADMIN_LOOPBACK_PUBLISHED=1` so loopback-published port `4322` can be initialized over the container bridge using a one-time terminal token. Retrieve it from the host terminal:

```sh
docker compose exec admin cat /app/.admin/setup-token
```

The setup token lives in the private credentials volume (mode `0600`), is never returned by any HTTP API, and is deleted once initialization completes. Running `npm run admin` directly on loopback requires no setup token. Every content, settings, media, and publish endpoint requires an authenticated session.

If you forget the password, there is no online reset route: stop the admin server, back up `.admin/auth.json` (inside `blog-admin` in Docker), move it aside manually, restart the admin server, and re-initialize credentials. Posts, Library, Friends, and uploaded files are untouched.

## Six Workspace Sections

| Section | Capabilities |
| --- | --- |
| **Settings** | Site identity, home & archive copy, 9 *About me* slots, navigation, page titles, post & library categories, theme, and footer |
| **Blog** | Create, edit, delete posts; Markdown edit/preview; insert images; drafts & publishing |
| **Library** | ACGN / Albums / Books / Others records with tags, covers, ratings, notes, album tracks, and linked posts |
| **Friends** | Friend name, URL, avatar/initials, description, label/type, sort order, visibility, and visitor applications inbox |
| **Files** | Upload files, preview images, copy URL / Markdown links, and delete unreferenced files |
| **Backup** | Export portable ZIP, inspect imported archives, confirm restore with automatic pre-restore rollback snapshots |

The nine *About me* slots in Settings select works from Library with custom slot labels (empty slots render `+`). Contact links for GitHub and Email activate automatically when populated.

When editing an **Albums** entry, you can upload multiple audio tracks at once or pick existing audio from **Files**, edit track titles, reorder with Move up / Move down, and save. Each audio file can appear at most once per album; uploading byte-identical audio reuses the existing file. Removing a track only unlinks it from that album.

Save via **Save** or `⌘ / Ctrl + S`. Unsaved changes trigger a confirmation prompt before switching records or sections. Writes use temp files plus atomic `rename`, and `revision` checks reject stale edits if the file changed in another tab or local editor. Deleting posts, Library entries, Friends, or Files requires explicit confirmation and has no recycle bin.

Friend IDs are auto-generated on creation and preserved on edits (hidden in the normal form) so renaming or reordering a friend keeps a stable identity.

### Posts & Drafts

New posts created in the CMS default to **Draft** checked. Drafts are excluded from Home, Blog, and RSS, generate no public pages, and have no public preview link until saved with Draft unchecked.

Hand-authored Markdown files require at least `title`, `date`, and body content; missing `summary`, `readTime`, `id`, and `slug` are derived consistently by `lib/posts.mjs`. Subdirectories and `description` / `pubDate` aliases are supported (`.md` only, not `.mdx`). Hand-authored files omit `draft` to publish publicly by default.

Post `id` stays fixed after creation; `slug` can be edited but changes the post URL. The CMS Markdown preview safely constructs text and image DOM nodes without executing raw HTML. Categories come from Settings; categories referenced by any post (including drafts) cannot be deleted (`409 Conflict`) until those posts are moved.

### Settings & Friends

The workspace opens on **01 Settings** (grouped into tabs, with collapsible sections and a live preview panel that reflects unsaved form values across Home, About, Archive, About me, Contact, Blog, Library, and Friends).

Home displays five chapters: Hero, About, 3D Archive, About me (9 works), and Contact/Uptime. `launchedAt` accepts timezone-aware ISO timestamps (e.g., `2026-10-20T21:28:15+08:00` or UTC `Z`); leave blank to hide the uptime counter. About `highlights` supports up to 6 entries (`label`, `title`, `description`, `period`, optional HTTP(S) `url`), reorderable in the UI.

Visible Friends appear in `/friends/` and in the 3D archive ordered by `order` ascending. When `friendApplicationsEnabled` is enabled (and not overridden by `PUBLIC_FRIEND_APPLICATIONS=0`), visitors can submit applications on `/friends/`; disabling it now blocks both the form UI and `POST /api/friend-applications` on the backend (`403`).

### Uploading, Using & Deleting Files

New uploads are saved under `public/static/` and served at `/static/`; legacy `/uploads/` paths remain readable. Docker mounts `blog-uploads` at `/app/public/static` (read-only in Nginx at `/var/www/static`).

**Files** supports images, passive SVGs, audio, documents, archives, and other files up to **256 MiB per file**. Both local paths (`/static/...`, `/images/...`) and external `http(s)://` URLs are supported.

Uploaded files can be deleted from **Files** (`DELETE /api/media/:id`). Before deleting, the backend checks `site.json`, `library.json`, `friends.json`, and all `blog/*.md` files (including drafts): if the file is still referenced anywhere, deletion is rejected with `409 Conflict` listing the referencing entries. Only unreferenced files are removed from disk and `src/content/media.json`.

## Backup & Restore

**Backup → Download ZIP** exports `site.json`, all posts (including drafts and subdirectories), `library.json`, `friends.json`, `media.json`, and referenced local/remote files (deduplicated by SHA-256 into `images/backup-<sha256>.<ext>` or `files/backup-<sha256>.<ext>`, rewriting references inside the ZIP without altering live files). Unreachable or invalid remote images keep their original URL and are listed in `warnings`.

Restoring is a two-step workflow (**Inspect ZIP** → **Restore backup → Replace & restore**) bound to the current session via a 15-minute preview token. Before replacing files, the server writes a `before-restore-…zip` recovery snapshot (`0600`, rotating the latest 5) into `ADMIN_AUTH_DIR/backups/`. Credentials, sessions, fonts, and built `dist/` files are never overwritten by backup restores.

Strict limits apply to ZIP validation (`personal-blog-backup` v1, no encryption/multi-volume/ZIP64): 256 MiB compressed, 512 MiB expanded, 10,000 entries, 256 MiB per upload file, 20 MiB per remote image, 8 MiB per JSON, 2 MiB per Markdown file.

## Content Paths & Persistence

| Path | Contents |
| --- | --- |
| `src/content/blog/**/*.md` | YAML frontmatter & Markdown bodies (supports subdirectories) |
| `src/content/library.json` | Library entries & album tracks |
| `src/content/friends.json` | Friend links |
| `src/content/site.json` | Site settings, navigation, categories & home copy |
| `src/content/media.json` | Uploaded file index (private to the CMS) |
| `public/static/` | Uploaded files |

Default `compose.yaml` uses four named volumes (`blog-content`, `blog-uploads`, `blog-published`, `blog-admin`). For host-folder editing, use `docker compose -f compose.yaml -f compose.files.yaml up -d --build` (see [Migration Guide](../docs/writing.md#已有命名卷先导出再切换) before switching an existing named-volume site).

## Runtime Configuration

| Variable | Default | Purpose |
| --- | --- | --- |
| `ADMIN_HOST` | `127.0.0.1` | Bind address (`0.0.0.0` in Docker). |
| `ADMIN_PORT` | `4322` | Listening port. |
| `ADMIN_SITE_URL` | `SITE_URL` or `http://127.0.0.1:4321` | Public site URL used for preview links and origin validation. |
| `ADMIN_AUTO_PUBLISH` | Unset | Set `1` to run `scripts/publish.mjs` on saves and watched file changes (enabled in Compose). |
| `ADMIN_WATCH_CONTENT` | Enabled with auto-publish | Set `0` to disable polling `src/content/` and `public/static/`. |
| `ADMIN_ALLOWED_HOSTS` | Loopback hosts for current port | Comma-separated extra allowed `Host` headers. |
| `ADMIN_AUTH_DIR` | `./.admin` | Private credentials, rollback snapshots, and friend-applications directory (`/app/.admin` in Docker). |
| `ADMIN_LOOPBACK_PUBLISHED` | Unset | Set `1` in Docker when port `4322` is published to loopback (`127.0.0.1`). |
| `ADMIN_TRUST_PROXY_IP` | Unset | Set `1` behind Nginx to read `X-Real-IP` for friend-application rate limiting. |
| `ADMIN_SECURE_COOKIES` | Unset | Set `1` behind an HTTPS reverse proxy to mark cookies `Secure`. |
| `ADMIN_ALLOW_REMOTE_SETUP` | Unset | Set `1` (with `ADMIN_SECURE_COOKIES=1`) to allow initial setup over HTTPS with a setup token. |
| `PUBLIC_FRIEND_APPLICATIONS` | Unset (uses `site.json`) | Set `1`/`true` or `0`/`false` to force-enable/disable `POST /api/friend-applications`. |

Example HTTPS reverse-proxy environment variables in `compose.yaml` (`services.admin.environment`):

```yaml
ADMIN_ALLOWED_HOSTS: cms.example.com
ADMIN_SECURE_COOKIES: "1"
ADMIN_ALLOW_REMOTE_SETUP: "1"
```

## API & Verification

- `GET /healthz`: Health check (no CSRF required).
- `GET /api/auth/status`: Returns `configured`, `authenticated`, `csrf`, `setupTokenRequired`, and basic site identity; sets bootstrap cookie when unauthenticated.
- `POST /api/auth/setup`: Initial account creation `{ username, password, setupToken? }`.
- `POST /api/auth/login`: Sign in `{ username, password }`.
- `GET|PUT /api/account`: Read or update `{ username, currentPassword, newPassword? }`.
- `POST /api/auth/logout`: Revoke active session.
- `GET /api/session`: Active CSRF token, categories, library types, `siteUrl`, and publish status.
- `POST /api/friend-applications`: Public submission `{ name, url, contact }` (when enabled); admin reads via `GET /api/friend-applications` and removes via `DELETE /api/friend-applications/:id`.
- `GET|POST /api/{blog,library,friends}` & `GET|PUT|DELETE /api/{blog,library,friends}/:id`: CRUD with `revision` check.
- `GET|PUT /api/settings`: Site settings with `revision` check and category usage guard.
- `GET /api/media`: List uploaded files; `POST /api/media`: raw upload (`X-File-Name`); `DELETE /api/media/:id`: delete unreferenced file (`409` if in use).
- `GET /api/backup/export`, `POST /api/backup/inspect`, `POST /api/backup/restore`: Backup export, two-step inspect & restore.
- `GET /api/publish/status`, `POST /api/publish`: Auto-publish and content-watch status / manual trigger.

Run full checks locally:

```sh
npm run check
npm test
npm run build
npm run verify
```

> `createServer({ auth: false })` is strictly for programmatic test fixtures (`tests/admin-security.test.mjs`); there is no CLI flag or environment variable to disable authentication.

## Starter Content & Templates

Initial deployment seeds `admin/defaults/` into a fresh `src/content/` once (two demo blog posts, three Library examples + three templates, and two Friends entries, all marked `demo: true`). See [Starter Content](../docs/content-examples.md) and [`admin/defaults/README.md`](./defaults/README.md).
