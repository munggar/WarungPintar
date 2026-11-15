import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const read = (path) => readFile(new URL(path, import.meta.url), 'utf8');

test('clear-search controls cover search inputs and text autocomplete search fields', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes("const SEARCH_CLEAR_SELECTOR = 'input[type=\"search\"], input[role=\"combobox\"][aria-autocomplete=\"list\"]'"));
  assert.ok(app.includes("button.className = 'search-clear-btn'"));
  assert.ok(app.includes("button.setAttribute('aria-label', 'Hapus kata pencarian')"));
  assert.ok(app.includes("button.title = 'Hapus pencarian'"));
  assert.ok(app.includes('enhanceSearchClearControls();'));
  assert.ok(app.includes('const searchClearObserver = new MutationObserver'));
  assert.ok(app.includes("searchClearObserver.observe(document.body, { childList: true, subtree: true });"));
});

test('search clear button empties the field and dispatches input so existing filters reset', async () => {
  const app = await read('../js/app.js');
  assert.ok(app.includes("const button = event.target.closest?.('.search-clear-btn')"));
  assert.ok(app.includes("input.value = '';"));
  assert.ok(app.includes("input.dispatchEvent(new Event('input', { bubbles: true }));"));
  assert.ok(app.includes('input.focus();'));
  assert.ok(app.includes("if (input.matches?.(SEARCH_CLEAR_SELECTOR)) updateSearchClearButton(input);"));
});

test('all current searchable form fields are included in the global enhancement', async () => {
  const app = await read('../js/app.js');
  assert.match(app, /id="q" type="search"/);
  assert.match(app, /id="pq" type="search"/);
  assert.match(app, /id="purchase-product-query" type="text" role="combobox" aria-autocomplete="list"/);
  assert.ok(app.includes('input[type="search"], input[role="combobox"][aria-autocomplete="list"]'));
});

test('search clear button layout remains responsive in both search rows and dialog fields', async () => {
  const css = await read('../css/style.css');
  assert.ok(css.includes('.row.search .search-input-wrap { flex: 1; min-width: 0; }'));
  assert.ok(css.includes('.search-input-wrap > input { width: 100%; min-width: 0; padding-right: 44px; }'));
  assert.ok(css.includes('.search-clear-btn[hidden] { display: none; }'));
  assert.ok(css.includes('.search-clear-btn:focus-visible'));
});
