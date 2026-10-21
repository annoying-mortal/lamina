#!/bin/sh
set -eu
node scripts/initialize-content.mjs
# This entrypoint owns the only publisher in this container. A previous
# container's PID may be reused after restart, so its lock cannot be trusted.
rm -f "${SITE_PUBLISH_ROOT:-/published}/.publish-lock"
if ! node scripts/publish.mjs; then
  echo '首次发布未成功，后台仍会启动以便修正内容；已有版本保持可用。' >&2
fi
exec node admin/server.mjs
