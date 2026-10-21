import test from 'node:test';
import assert from 'node:assert/strict';
import { siteRuntime } from '../lib/site-runtime.mjs';

test('运行时间按实际时间和时区计算，跨天进位且不受构建时刻影响', () => {
  const start = '2026-10-20T21:28:15+08:00';
  assert.deepEqual(siteRuntime(start, Date.parse('2026-10-21T13:28:14Z')), { pending: false, days: 0, hours: 23, minutes: 59, seconds: 59 });
  assert.deepEqual(siteRuntime(start, Date.parse('2026-10-21T13:28:15Z')), { pending: false, days: 1, hours: 0, minutes: 0, seconds: 0 });
  assert.deepEqual(siteRuntime(start, Date.parse('2027-10-20T13:28:15Z')), { pending: false, days: 365, hours: 0, minutes: 0, seconds: 0 });
});

test('未配置时间不伪造运行时长，未来启用时间不显示负数', () => {
  assert.equal(siteRuntime(''), null);
  assert.equal(siteRuntime('not-a-date'), null);
  assert.deepEqual(siteRuntime('2027-01-01T00:00:00Z', Date.parse('2026-10-20T00:00:00Z')), { pending: true, days: 0, hours: 0, minutes: 0, seconds: 0 });
});
