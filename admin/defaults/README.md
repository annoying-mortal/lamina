# First-deployment content

This directory is the distributable starter snapshot. It includes the site placeholders, a Markdown guide and `Enter Title` article, an example and template for each of ACGN / Albums / Books, and two Friends entries.

Docker excludes the local `src/content/` directory and initializes its image from this snapshot. This prevents local articles, settings and CMS edits from becoming another site's default content. Existing named volumes and folder mounts remain authoritative.

`scripts/initialize-content.mjs` seeds an empty content directory once. After initialization, deleting examples or clearing lists does not bring them back on restart. An existing directory without a marker is treated as an existing site: its records remain untouched and missing Library / Friends files become empty lists.

When deliberately updating the template's initial examples, update this snapshot as well as the local demonstration files in `src/content/`. Do not copy user-authored articles or private settings into this directory. Illustration files live in `public/images/`; remote cover sources are documented in [content examples](../../docs/content-examples.md).
