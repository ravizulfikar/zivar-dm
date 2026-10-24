import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

// Chrome rejects a second item with the same id ("Cannot create item with duplicate id"). The menu is
// rebuilt on install, on start-up and when the language changes, so these calls overlap in practice.
function loadBackground() {
  const listener = { addListener() {} };
  const items = new Map(), errors = [];
  let lastError;
  const later = callback => setTimeout(callback, 5);
  const chrome = {
    runtime: { id: 'test', getURL: value => `chrome-extension://test/${value}`, onInstalled: { handlers: [], addListener(handler) { this.handlers.push(handler); } }, onMessage: listener,
      get lastError() { return lastError; } },
    contextMenus: {
      removeAll(callback) { later(() => { items.clear(); callback?.(); }); },
      create(item, callback) {
        later(() => {
          if (items.has(item.id)) { lastError = { message: `Cannot create item with duplicate id ${item.id}` }; errors.push(lastError.message); }
          else items.set(item.id, item);
          callback?.(); lastError = undefined;
        });
        return item.id;
      },
      onClicked: listener,
    },
    webRequest: { onBeforeSendHeaders: listener, onHeadersReceived: listener },
    tabs: { onUpdated: listener, onRemoved: listener, sendMessage: () => Promise.resolve() },
    downloads: { onCreated: listener, onDeterminingFilename: listener },
    windows: { onRemoved: listener },
    storage: { local: { get: async () => ({}), set: async () => {}, remove: async () => {} }, session: { get: async () => ({}), set: async () => {}, remove: async () => {} }, onChanged: listener },
    action: {},
    alarms: { create() {}, onAlarm: listener },
  };
  const context = { chrome, fetch, URL, Map, Date, Set, Number, String, RegExp, Promise, AbortSignal, console, setTimeout, clearTimeout, importScripts() {} };
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(new URL('../extension/i18n.js', import.meta.url), 'utf8'), context);
  vm.runInContext(fs.readFileSync(new URL('../extension/background.js', import.meta.url), 'utf8'), context);
  return { chrome, items, errors, context };
}

test('overlapping menu rebuilds never create a duplicate id', async () => {
  const { chrome, items, errors, context } = loadBackground();
  await context.ZI.ready;
  for (const handler of chrome.runtime.onInstalled.handlers) handler({ reason: 'install' });
  context.ZI.onChange.forEach(callback => callback());
  context.ZI.onChange.forEach(callback => callback());
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.deepEqual(errors, []);
  assert.equal(items.size, 1);
  assert.equal(items.get('zivar-download').title, 'Download with ZIVAR');
});

test('the menu title follows the language', async () => {
  const { items, context } = loadBackground();
  await context.ZI.ready;
  context.ZI.set('id');
  context.ZI.onChange.forEach(callback => callback());
  await new Promise(resolve => setTimeout(resolve, 200));
  assert.equal(items.get('zivar-download').title, 'Unduh dengan ZIVAR');
});
