import { formatWib, rupiah, saleTotal } from './logic.js';

const WIDTH = 720;
const PAGE_HEIGHT = 1800;
const MARGIN = 42;
const FONT = '28px Arial, sans-serif';

function safeReceiptId(sale) {
  const id = String(sale?.id || '');
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('ID transaksi tidak valid untuk nama file struk.');
  return id;
}

function statusText(sale) {
  if (sale.statusPembayaran === 'menunggu_konfirmasi') return 'Menunggu konfirmasi pembayaran';
  if (sale.statusPembayaran === 'dibatalkan') return 'Dibatalkan';
  if (sale.metode === 'kasbon') return 'Belum lunas (kasbon)';
  if (!sale.statusPembayaran || sale.statusPembayaran === 'berhasil') return 'Berhasil dibayar';
  return 'Status pembayaran tidak diketahui';
}

function wrapText(context, text, maxWidth) {
  const words = String(text).split(/\s+/);
  const lines = [];
  let line = '';
  for (const word of words) {
    const next = line ? `${line} ${word}` : word;
    if (line && context.measureText(next).width > maxWidth) {
      lines.push(line);
      line = word;
    } else {
      line = next;
    }
  }
  if (line) lines.push(line);
  return lines;
}

export function renderReceiptCanvas(sale, store = {}) {
  safeReceiptId(sale);
  if (!sale.waktu || Number.isNaN(new Date(sale.waktu).valueOf()) || !['tunai', 'transfer', 'qris', 'kasbon'].includes(sale.metode)) {
    throw new Error('Data waktu atau metode pembayaran transaksi tidak valid.');
  }
  if (!Array.isArray(sale.items) || !sale.items.length || sale.items.some((item) =>
    typeof item.nama !== 'string' || !item.nama || !Number.isSafeInteger(item.qty) || item.qty <= 0
    || !Number.isSafeInteger(item.hargaJual) || item.hargaJual < 0
  )) throw new Error('Rincian produk transaksi tidak valid untuk membuat struk.');
  if (!Number.isSafeInteger(saleTotal(sale))) throw new Error('Total transaksi melebihi batas nilai struk yang aman.');
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Browser tidak dapat membuat gambar struk.');
  context.font = FONT;
  const textWidth = WIDTH - MARGIN * 2;
  const measured = [];
  const add = (text, { bold = false, align = 'left', gap = 0, maxWidth = textWidth } = {}) => {
    context.font = `${bold ? '700 ' : ''}${FONT}`;
    for (const line of wrapText(context, text, maxWidth)) measured.push({ text: line, bold, align, gap });
  };
  add(store.toko || 'WarungPintar', { bold: true, align: 'center', gap: 4 });
  if (store.alamat) add(store.alamat, { align: 'center' });
  if (store.kontak) add(`Kontak: ${store.kontak}`, { align: 'center' });
  add(`Transaksi: ${sale.id}`);
  add(formatWib(sale.waktu));
  if (sale.namaKasir) add(`Kasir: ${sale.namaKasir}`);
  if (sale.customerName) add(`Pelanggan: ${sale.customerName}`);
  add(`Status: ${statusText(sale)}`, { bold: true, gap: 8 });
  measured.push({ rule: true });
  for (const item of sale.items) {
    add(item.nama, { bold: true });
    add(`${item.qty} x ${rupiah(item.hargaJual)}`, { align: 'left' });
    add(rupiah(item.qty * item.hargaJual), { align: 'right', gap: 5 });
  }
  measured.push({ rule: true });
  add(`Total  ${rupiah(saleTotal(sale))}`, { bold: true, align: 'right', gap: 5 });
  add(`Metode: ${sale.metode.toUpperCase()}`);
  if (sale.metode === 'tunai' && sale.diterima != null) {
    add(`Diterima: ${rupiah(sale.diterima)}`);
    add(`Kembalian: ${rupiah(sale.diterima - saleTotal(sale))}`);
  }
  if (sale.dibayarPada) add(`Dikonfirmasi: ${formatWib(sale.dibayarPada)}`);
  add('Terima kasih telah berbelanja.', { align: 'center', gap: 12 });

  const lineHeight = 40;
  canvas.height = Math.max(240, measured.reduce((height, line) => height + (line.rule ? 24 : lineHeight + line.gap), MARGIN * 2));
  context.fillStyle = '#ffffff';
  context.fillRect(0, 0, canvas.width, canvas.height);
  context.fillStyle = '#172033';
  context.textBaseline = 'top';
  let y = MARGIN;
  for (const line of measured) {
    if (line.rule) {
      y += 8;
      context.strokeStyle = '#8792a8';
      context.setLineDash([8, 7]);
      context.beginPath();
      context.moveTo(MARGIN, y);
      context.lineTo(WIDTH - MARGIN, y);
      context.stroke();
      context.setLineDash([]);
      y += 16;
      continue;
    }
    context.font = `${line.bold ? '700 ' : ''}${FONT}`;
    context.textAlign = line.align;
    const x = line.align === 'center' ? WIDTH / 2 : line.align === 'right' ? WIDTH - MARGIN : MARGIN;
    context.fillText(line.text, x, y, textWidth);
    y += lineHeight + line.gap;
  }
  return canvas;
}

function ascii(value) {
  return new TextEncoder().encode(value);
}

function concatenate(chunks) {
  const length = chunks.reduce((total, chunk) => total + chunk.length, 0);
  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.length;
  }
  return result;
}

async function jpegBytes(canvas) {
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Browser gagal merender JPG untuk struk.')),
    'image/jpeg',
    0.94,
  ));
  return new Uint8Array(await blob.arrayBuffer());
}

function pageSliceHeight(canvas, top) {
  const remaining = canvas.height - top;
  if (remaining <= PAGE_HEIGHT) return remaining;
  const searchHeight = Math.min(240, PAGE_HEIGHT - 1);
  const searchTop = top + PAGE_HEIGHT - searchHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  const pixels = context.getImageData(0, searchTop, WIDTH, searchHeight).data;
  for (let y = searchHeight - 1; y >= 0; y--) {
    let blank = true;
    for (let x = 0; x < WIDTH; x++) {
      const pixel = (y * WIDTH + x) * 4;
      if (pixels[pixel] < 250 || pixels[pixel + 1] < 250 || pixels[pixel + 2] < 250) {
        blank = false;
        break;
      }
    }
    if (blank) return searchTop + y + 1 - top;
  }
  return PAGE_HEIGHT;
}

export async function receiptJpeg(sale, store) {
  const canvas = renderReceiptCanvas(sale, store);
  const blob = await new Promise((resolve, reject) => canvas.toBlob(
    (value) => value ? resolve(value) : reject(new Error('Browser gagal merender JPG untuk struk.')),
    'image/jpeg',
    0.94,
  ));
  return new File([blob], `struk-${safeReceiptId(sale)}.jpg`, { type: 'image/jpeg' });
}

export async function receiptPdf(sale, store) {
  const canvas = renderReceiptCanvas(sale, store);
  const pages = [];
  for (let top = 0; top < canvas.height;) {
    const height = pageSliceHeight(canvas, top);
    const page = document.createElement('canvas');
    page.width = WIDTH;
    page.height = height;
    const context = page.getContext('2d');
    if (!context) throw new Error('Browser tidak dapat menyiapkan halaman PDF struk.');
    context.drawImage(canvas, 0, top, WIDTH, height, 0, 0, WIDTH, height);
    pages.push({ height, jpeg: await jpegBytes(page) });
    top += height;
  }

  const pageIds = pages.map((_, index) => 3 + index * 3);
  const objects = [
    ascii('<< /Type /Catalog /Pages 2 0 R >>'),
    ascii(`<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pages.length} >>`),
  ];
  for (let index = 0; index < pages.length; index++) {
    const page = pages[index];
    const pageId = pageIds[index];
    const contentId = pageId + 1;
    const imageId = pageId + 2;
    const heightPt = (page.height / WIDTH) * 240;
    const content = ascii(`q\n240 0 0 ${heightPt.toFixed(3)} 0 0 cm\n/Im0 Do\nQ`);
    objects.push(
      ascii(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 240 ${heightPt.toFixed(3)}] /Resources << /XObject << /Im0 ${imageId} 0 R >> >> /Contents ${contentId} 0 R >>`),
      concatenate([ascii(`<< /Length ${content.length} >>\nstream\n`), content, ascii('\nendstream')]),
      concatenate([
        ascii(`<< /Type /XObject /Subtype /Image /Width ${WIDTH} /Height ${page.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`),
        page.jpeg,
        ascii('\nendstream'),
      ]),
    );
  }
  const chunks = [ascii('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n')];
  const offsets = [0];
  let position = chunks[0].length;
  for (let index = 0; index < objects.length; index++) {
    offsets.push(position);
    const object = concatenate([ascii(`${index + 1} 0 obj\n`), objects[index], ascii('\nendobj\n')]);
    chunks.push(object);
    position += object.length;
  }
  const xrefOffset = position;
  const xref = [`xref\n0 ${objects.length + 1}\n`, '0000000000 65535 f \n'];
  for (const offset of offsets.slice(1)) xref.push(`${String(offset).padStart(10, '0')} 00000 n \n`);
  xref.push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`);
  chunks.push(ascii(xref.join('')));
  return new File([concatenate(chunks)], `struk-${safeReceiptId(sale)}.pdf`, { type: 'application/pdf' });
}
