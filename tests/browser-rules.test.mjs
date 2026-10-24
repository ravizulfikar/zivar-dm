import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DEFAULT_BROWSER_DOWNLOAD_TYPES,
  DEFAULT_BROWSER_DOWNLOAD_SITE_EXCLUSIONS,
  normalizeBrowserDownloadTypes,
  normalizeBrowserDownloadSiteExclusions,
} from '../app/manager.mjs';

test('site exclusions accept plain and wildcard hosts', () => {
  assert.deepEqual(normalizeBrowserDownloadSiteExclusions('*.example.com, Download.Example.org'), ['*.example.com', 'download.example.org']);
});

test('site exclusions reject malformed hosts', () => {
  // Only a literal dot may separate labels, so "foo_bar" and "foo/bar" are not hosts.
  assert.deepEqual(normalizeBrowserDownloadSiteExclusions('foo_bar\nhttp://x.com\nfoo/bar.com\n-bad.com'), []);
});

test('file types are upper-cased, deduplicated and validated', () => {
  assert.deepEqual(normalizeBrowserDownloadTypes('.zip, ZIP; r0*\n../etc'), ['ZIP', 'R0*']);
});

test('empty settings turn automatic capture off, unset settings use the defaults', () => {
  assert.deepEqual(normalizeBrowserDownloadTypes(''), []);
  assert.deepEqual(normalizeBrowserDownloadTypes(undefined), [...DEFAULT_BROWSER_DOWNLOAD_TYPES]);
});

// The extension cannot import app code, so it carries its own copy of the defaults
// for when the app is unreachable. The two copies must not drift apart.
test('extension defaults match the app defaults', () => {
  const source = fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8');
  const list = name => {
    const start = source.indexOf(`const ${name} = [`);
    const body = source.slice(start, source.indexOf('];', start));
    return [...body.matchAll(/'([^']+)'/g)].map(match => match[1]);
  };
  assert.deepEqual(list('defaultBrowserDownloadTypes'), [...DEFAULT_BROWSER_DOWNLOAD_TYPES]);
  assert.deepEqual(list('defaultBrowserDownloadSiteExclusions'), [...DEFAULT_BROWSER_DOWNLOAD_SITE_EXCLUSIONS]);
});
