/**
 * Elapsed time since the configured site launch, independent of the build time.
 * @param {string} launchedAt
 * @param {number} [now]
 */
export function siteRuntime(launchedAt, now = Date.now()) {
  const start = Date.parse(launchedAt);
  if (!Number.isFinite(start) || !Number.isFinite(now)) return null;
  const elapsed = Math.max(0, Math.floor((now - start) / 1000));
  return {
    pending: start > now,
    days: Math.floor(elapsed / 86400),
    hours: Math.floor(elapsed % 86400 / 3600),
    minutes: Math.floor(elapsed % 3600 / 60),
    seconds: elapsed % 60,
  };
}
