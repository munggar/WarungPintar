import { decryptJson, encryptJson } from './crypto.js';

// Legacy object stores are kept for one-time migration; active data lives in one encrypted vault.
const DB_NAME = 'warungpintar';
const VERSION = 2;
export const STORES = ['products', 'sales', 'purchases', 'expenses', 'customers', 'debts', 'payments', 'withdrawals', 'settings'];
export const TRANSACTION_STORES = ['sales', 'purchases', 'expenses', 'debts', 'payments', 'withdrawals'];
let dbp;
let vaultKey = null;
let vault = null;
let vaultId = 'local';
let generation = 0;
let dirty = false;
let mutationListener = () => {};
let mutationQueue = Promise.resolve();
let persistenceQueue = Promise.resolve();

const clone = (value) => structuredClone(value);
const emptyVault = () => Object.fromEntries(STORES.map((name) => [name, []]));
const assertUnlocked = () => {
  if (!vaultKey || !vault) throw new Error('Penyimpanan terkunci. Silakan login untuk membuka data.');
};
const keyOf = (store, value) => store === 'settings' ? value.key : value.id;

export function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, VERSION);
      request.onupgradeneeded = () => {
        for (const name of STORES) {
          if (!request.result.objectStoreNames.contains(name)) {
            request.result.createObjectStore(name, { keyPath: name === 'settings' ? 'key' : 'id' });
          }
        }
        if (!request.result.objectStoreNames.contains('vault')) request.result.createObjectStore('vault', { keyPath: 'key' });
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }
  return dbp;
}

function readStore(store, key) {
  return open().then((database) => new Promise((resolve, reject) => {
    const transaction = database.transaction(store, 'readonly');
    const request = key === undefined ? transaction.objectStore(store).getAll() : transaction.objectStore(store).get(key);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  }));
}

function saveEncryptedVault() {
  const save = async () => {
    const encrypted = await encryptJson(vaultKey, { data: vault, dirty, generation });
    const database = await open();
    await new Promise((resolve, reject) => {
      const transaction = database.transaction('vault', 'readwrite');
      transaction.objectStore('vault').put({ key: `snapshot:${vaultId}`, ...encrypted });
      transaction.oncomplete = resolve;
      transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Gagal menyimpan penyimpanan terenkripsi.'));
    });
  };
  persistenceQueue = persistenceQueue.catch(() => {}).then(save);
  return persistenceQueue;
}

async function clearLegacyStores() {
  const database = await open();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(STORES, 'readwrite');
    for (const store of STORES) transaction.objectStore(store).clear();
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Gagal menghapus salinan data lama.'));
  });
}

export async function configureVault(key, storeId = 'local', { startEmpty = false } = {}) {
  const database = await open();
  const encrypted = await readStore('vault', `snapshot:${storeId}`);
  vaultId = storeId;
  vaultKey = key;
  let wasLegacy = false;
  if (encrypted) {
    const restored = await decryptJson(key, encrypted);
    vault = restored.data;
    dirty = Boolean(restored.dirty);
    generation = Number(restored.generation) || 0;
    await clearLegacyStores();
  } else if (startEmpty) {
    vault = emptyVault();
    dirty = false;
    generation = 0;
    wasLegacy = false;
    await saveEncryptedVault();
    await clearLegacyStores();
  } else {
    vault = emptyVault();
    for (const store of STORES) {
      vault[store] = await readStore(store);
    }
    vault.settings = vault.settings.filter((row) => !['pin', 'role'].includes(row.key));
    dirty = STORES.slice(0, -1).some((store) => vault[store].length > 0);
    generation = 0;
    wasLegacy = true;
    await saveEncryptedVault();
    await clearLegacyStores();
  }
  if (!database.objectStoreNames.contains('vault')) throw new Error('Versi database tidak mendukung penyimpanan terenkripsi.');
  return { data: clone(vault), dirty, generation, migrated: wasLegacy };
}

export function lockVault() {
  vaultKey = null;
  vault = null;
  vaultId = 'local';
  generation = 0;
  dirty = false;
}

export function setMutationListener(listener) {
  mutationListener = typeof listener === 'function' ? listener : () => {};
}

function enqueueWrite(operation) {
  const result = mutationQueue.then(operation);
  mutationQueue = result.catch(() => {});
  return result;
}

export async function all(store) {
  assertUnlocked();
  if (!STORES.includes(store)) throw new Error(`Penyimpanan tidak dikenal: ${store}`);
  return clone(vault[store]);
}

export function put(store, value) {
  assertUnlocked();
  if (!STORES.includes(store)) return Promise.reject(new Error(`Penyimpanan tidak dikenal: ${store}`));
  return enqueueWrite(async () => {
    const key = keyOf(store, value);
    const rows = vault[store];
    const index = rows.findIndex((row) => keyOf(store, row) === key);
    if (index < 0) rows.push(clone(value));
    else rows[index] = clone(value);
    generation++;
    dirty = true;
    await saveEncryptedVault();
    mutationListener();
  });
}

export function del(store, key) {
  assertUnlocked();
  if (!STORES.includes(store)) return Promise.reject(new Error(`Penyimpanan tidak dikenal: ${store}`));
  return enqueueWrite(async () => {
    vault[store] = vault[store].filter((row) => keyOf(store, row) !== key);
    generation++;
    dirty = true;
    await saveEncryptedVault();
    mutationListener();
  });
}

export function clear(store) {
  assertUnlocked();
  if (!STORES.includes(store)) return Promise.reject(new Error(`Penyimpanan tidak dikenal: ${store}`));
  return enqueueWrite(async () => {
    vault[store] = [];
    generation++;
    dirty = true;
    await saveEncryptedVault();
    mutationListener();
  });
}

// Mutations operate on an isolated copy and commit to the encrypted vault as one unit.
export function atomic(stores, fn) {
  assertUnlocked();
  return enqueueWrite(async () => {
    const next = clone(vault);
    let callbackError = null;
    const objectStore = (name) => ({
      get(key) {
        const request = { result: undefined, onsuccess: null };
        queueMicrotask(() => {
          request.result = clone(next[name].find((row) => keyOf(name, row) === key));
          try { request.onsuccess?.({ target: request }); } catch (error) { callbackError = error; }
        });
        return request;
      },
      getAll() {
        const request = { result: undefined, onsuccess: null };
        queueMicrotask(() => {
          request.result = clone(next[name]);
          try { request.onsuccess?.({ target: request }); } catch (error) { callbackError = error; }
        });
        return request;
      },
      put(value) {
        const key = keyOf(name, value);
        const index = next[name].findIndex((row) => keyOf(name, row) === key);
        if (index < 0) next[name].push(clone(value));
        else next[name][index] = clone(value);
        return {};
      },
      delete(key) {
        next[name] = next[name].filter((row) => keyOf(name, row) !== key);
        return {};
      },
      clear() {
        next[name] = [];
        return {};
      },
    });
    fn((name) => {
      if (!stores.includes(name)) throw new Error(`Penyimpanan ${name} tidak termasuk transaksi.`);
      return objectStore(name);
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    if (callbackError) throw callbackError;
    vault = next;
    generation++;
    dirty = true;
    await saveEncryptedVault();
    mutationListener();
  });
}

// Update stock in a transaction backed by the encrypted vault.
export function adjustStock(store, productId, delta, newHargaBeli) {
  if (!Number.isSafeInteger(delta)) throw new Error('Perubahan stok harus berupa bilangan bulat yang aman.');
  if (newHargaBeli != null && (!Number.isSafeInteger(newHargaBeli) || newHargaBeli < 0)) {
    throw new Error('Harga beli baru harus berupa bilangan rupiah bulat yang tidak negatif.');
  }
  const request = store('products').get(productId);
  request.onsuccess = () => {
    const product = request.result;
    if (!product) throw new Error('Produk tidak ditemukan saat memperbarui stok.');
    if (!Number.isSafeInteger(product.stok) || product.stok < 0) {
      throw new Error(`Stok produk ${product.nama || productId} tidak valid.`);
    }
    const nextStock = product.stok + delta;
    if (!Number.isSafeInteger(nextStock) || nextStock < 0) {
      throw new Error(`Stok produk ${product.nama || productId} tidak mencukupi.`);
    }
    product.stok = nextStock;
    if (newHargaBeli != null) product.hargaBeli = newHargaBeli;
    store('products').put(product);
  };
}

export function vaultSnapshot() {
  assertUnlocked();
  return { data: clone(vault), generation, dirty };
}

export async function markSynced(savedGeneration) {
  assertUnlocked();
  return enqueueWrite(async () => {
    if (generation !== savedGeneration || !dirty) return false;
    dirty = false;
    await saveEncryptedVault();
    return true;
  });
}

export async function replaceVaultData(data) {
  assertUnlocked();
  for (const store of STORES) {
    if (!Array.isArray(data?.[store])) throw new Error(`Data tersinkron tidak valid: ${store}.`);
  }
  return enqueueWrite(async () => {
    vault = Object.fromEntries(STORES.map((store) => [
      store,
      store === 'settings' ? clone(data[store].filter((row) => !['pin', 'role'].includes(row.key))) : clone(data[store]),
    ]));
    generation++;
    dirty = false;
    await saveEncryptedVault();
  });
}

export async function exportAll() {
  assertUnlocked();
  const out = { app: 'WarungPintar', versi: 2, diekspor: new Date().toISOString() };
  for (const store of STORES) out[store] = clone(vault[store]);
  return out;
}

export async function legacyExportAll() {
  const out = { app: 'WarungPintar', versi: 1, diekspor: new Date().toISOString() };
  for (const store of STORES) {
    const rows = await readStore(store);
    out[store] = store === 'settings' ? rows.filter((row) => !['pin', 'role'].includes(row.key)) : rows;
  }
  return out;
}

export async function importAll(data) {
  if (!data || data.app !== 'WarungPintar') throw new Error('Berkas bukan cadangan WarungPintar.');
  const valid = Object.fromEntries(STORES.map((store) => [store, Array.isArray(data[store]) ? data[store] : []]));
  assertUnlocked();
  await enqueueWrite(async () => {
    vault = Object.fromEntries(STORES.map((store) => [
      store,
      store === 'settings' ? clone(valid[store].filter((row) => !['pin', 'role'].includes(row.key))) : clone(valid[store]),
    ]));
    generation++;
    dirty = true;
    await saveEncryptedVault();
    mutationListener();
  });
}

export async function wipe() {
  await atomic(STORES, (store) => STORES.forEach((name) => store(name).clear()));
}

export async function clearTransactions() {
  await atomic(TRANSACTION_STORES, (store) => TRANSACTION_STORES.forEach((name) => store(name).clear()));
}
