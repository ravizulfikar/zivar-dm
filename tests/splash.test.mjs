import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { shouldShowSplash, splashMinMs, splashHtml, SPLASH_MIN_MS, SPLASH_TITLE } from '../desktop/splashContent.mjs';

const content = { version: '0.20.0', tagline: 'Fast, local and private downloads', starting: 'Starting', website: 'zivar.my.id' };

test('the splash shows on a normal start', () => {
  assert.equal(shouldShowSplash({}), true);
  assert.equal(shouldShowSplash({}, { enabled: true }), true);
});

test('the setting, test mode and the hidden start all keep it away', () => {
  assert.equal(shouldShowSplash({}, { enabled: false }), false, 'turned off in Settings');
  assert.equal(shouldShowSplash({}, { automated: true }), false, 'a test must find the real window first');
  assert.equal(shouldShowSplash({}, { hidden: true }), false, 'start at login goes straight to the tray');
});

test('ZIVAR_SPLASH overrides the setting and test mode, but never the hidden start', () => {
  assert.equal(shouldShowSplash({ ZIVAR_SPLASH: '0' }), false);
  assert.equal(shouldShowSplash({ ZIVAR_SPLASH: '1' }, { automated: true }), true);
  assert.equal(shouldShowSplash({ ZIVAR_SPLASH: '1' }, { enabled: false }), true);
  assert.equal(shouldShowSplash({ ZIVAR_SPLASH: '1' }, { hidden: true }), false, 'a window must not pop up while starting into the tray');
});

test('the minimum time can be changed and falls back for bad values', () => {
  assert.equal(splashMinMs({}), SPLASH_MIN_MS);
  assert.equal(splashMinMs({ ZIVAR_SPLASH_MIN_MS: '4000' }), 4000);
  assert.equal(splashMinMs({ ZIVAR_SPLASH_MIN_MS: '0' }), 0);
  for (const bad of ['', '  ', 'abc', '-5']) assert.equal(splashMinMs({ ZIVAR_SPLASH_MIN_MS: bad }), SPLASH_MIN_MS, `"${bad}"`);
});

test('the page shows the name, tagline, version and website', () => {
  const html = splashHtml(content);
  for (const text of ['ZIVAR Download Manager', 'Fast, local and private downloads', 'v0.20.0', 'zivar.my.id', 'Starting']) assert.ok(html.includes(text), text);
  assert.ok(html.includes(`<title>${SPLASH_TITLE}</title>`));
});

test('the page is self-contained: no script, no network, a locked-down policy', () => {
  const html = splashHtml(content);
  assert.doesNotMatch(html, /<script/i);
  assert.doesNotMatch(html, /(src|href)\s*=\s*["']?(https?:|\/\/|file:)/i);
  assert.match(html, /Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/);
});

test('text that comes from outside is escaped', () => {
  const html = splashHtml({ ...content, version: '1.0<script>alert(1)</script>', tagline: '"><img src=x onerror=alert(1)>' });
  assert.doesNotMatch(html, /<script>alert|<img src=x/i);
  assert.match(html, /&lt;script&gt;/);
});

test('people who prefer reduced motion get the finished picture', () => {
  const html = splashHtml(content);
  assert.match(html, /prefers-reduced-motion: reduce/);
  assert.match(html, /animation-duration: 0\.01ms !important/);
});

test('the logo in the splash is the same Z as the app icon', () => {
  const logo = fs.readFileSync(new URL('../docs/assets/logo.svg', import.meta.url), 'utf8');
  const html = splashHtml(content);
  // The splash draws the Z in two animated strokes; both paths must match the logo file.
  for (const d of [/d="(M140 136H372L148 366H372)"/.exec(logo)?.[1], /d="(M148 246V366)"/.exec(logo)?.[1]]) {
    assert.ok(d, 'the logo file changed shape; update the splash too');
    assert.ok(html.includes(`d="${d}"`), `splash is missing ${d}`);
  }
});
