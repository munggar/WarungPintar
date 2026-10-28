import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createXlsx } from '../js/xlsx.js';

test('membuat berkas xlsx valid berisi lembar kerja dan nilai sel', () => {
  const bytes = createXlsx([['Produk', 'Jumlah'], ['Kopi & Teh', 3]]);
  const text = new TextDecoder().decode(bytes);
  assert.equal(new DataView(bytes.buffer).getUint32(0, true), 0x04034b50);
  assert.ok(text.includes('xl/workbook.xml'));
  assert.ok(text.includes('<sheet name="Penjualan"'));
  assert.ok(text.includes('Kopi &amp; Teh'));
  assert.ok(text.includes('<c r="B2"><v>3</v></c>'));
  assert.equal(new DataView(bytes.buffer).getUint32(bytes.length - 22, true), 0x06054b50);
});

test('menolak data lembar kerja yang tidak berbentuk daftar baris', () => {
  assert.throws(() => createXlsx([]), TypeError);
  assert.throws(() => createXlsx([['judul'], null]), TypeError);
});
