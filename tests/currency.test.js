import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatRupiahInput, parseRupiahInput } from '../js/currency.js';

test('format harga memberi pemisah ribuan dan mengabaikan karakter selain angka', () => {
  assert.equal(formatRupiahInput('1234567'), '1.234.567');
  assert.equal(formatRupiahInput('Rp 1.234.567'), '1.234.567');
  assert.equal(formatRupiahInput('0000'), '0');
});

test('parse harga menerima nilai berformat dan membiarkan input kosong', () => {
  assert.equal(parseRupiahInput('1.234.567'), 1234567);
  assert.equal(parseRupiahInput(''), null);
});
