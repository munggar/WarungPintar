import * as db from './db.js';
import {
  createRecoveryCode, createVaultKey, decryptJson, encryptJson,
  makePasswordEnvelope, makeRecoveryEnvelope, openPasswordEnvelope, openRecoveryEnvelope,
} from './crypto.js';
import * as supabase from './supabase.js';

const hasLocalBusinessData = (data) =>
  ['products', 'sales', 'purchases', 'expenses', 'customers', 'debts', 'payments', 'withdrawals']
    .some((store) => (data[store] || []).length > 0);
const syncKey = (storeId) => `warungpintar:revision:${storeId}`;
const OFFLINE_KEY = 'warungpintar:offline-account';

function rememberRevision(storeId, revision) {
  localStorage.setItem(syncKey(storeId), String(revision));
  const cached = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null');
  if (cached?.storeId === storeId) {
    cached.revision = revision;
    localStorage.setItem(OFFLINE_KEY, JSON.stringify(cached));
  }
}
const DEVICE_DB = 'warungpintar-remembered-device';
const DEVICE_STORE = 'keys';
let context = null;
let syncing = null;
let syncTimer = null;
let syncStatusListener = () => {};
let syncErrorListener = () => {};
let pendingConflict = null;
let autoSyncStarted = false;

function openDeviceDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DEVICE_DB, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DEVICE_STORE, { keyPath: 'userId' });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function getRememberedKey(userId) {
  const database = await openDeviceDb();
  return new Promise((resolve, reject) => {
    const request = database.transaction(DEVICE_STORE, 'readonly').objectStore(DEVICE_STORE).get(userId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
  });
}

async function storeRememberedKey(userId, dataKey) {
  const deviceKey = await crypto.subtle.generateKey({ name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const rawKey = await crypto.subtle.exportKey('raw', dataKey);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, deviceKey, rawKey);
  const database = await openDeviceDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_STORE, 'readwrite');
    transaction.objectStore(DEVICE_STORE).put({ userId, deviceKey, iv, ciphertext });
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Gagal menyimpan kunci perangkat.'));
  });
}

async function openRememberedKey(record) {
  const rawKey = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: record.iv },
    record.deviceKey,
    record.ciphertext,
  );
  return crypto.subtle.importKey('raw', rawKey, 'AES-GCM', true, ['encrypt', 'decrypt']);
}

async function removeRememberedKey(userId) {
  if (!userId) return;
  const database = await openDeviceDb();
  await new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_STORE, 'readwrite');
    transaction.objectStore(DEVICE_STORE).delete(userId);
    transaction.oncomplete = resolve;
    transaction.onerror = transaction.onabort = () => reject(transaction.error || new Error('Gagal menghapus kunci perangkat.'));
  });
}

function setStatus(message, state = 'ok') {
  syncStatusListener({ message, state });
}

function envelopePayload(storeId, userId, envelope) {
  return {
    store_id: storeId,
    user_id: userId,
    password_salt: envelope.salt,
    password_iv: envelope.iv,
    password_wrapped_key: envelope.wrapped,
  };
}

async function getMembership(userId) {
  const memberships = await supabase.select('store_members', `select=store_id,role&user_id=eq.${encodeURIComponent(userId)}`);
  if (!memberships.length) throw new Error('Akun belum terhubung ke toko. Hubungi pemilik atau cek undangan email.');
  const member = memberships[0];
  const stores = await supabase.select('stores', `select=id,name&id=eq.${encodeURIComponent(member.store_id)}`);
  if (!stores.length) throw new Error('Data toko tidak ditemukan atau akses akun belum aktif.');
  return { storeId: member.store_id, role: member.role, storeName: stores[0].name };
}

async function readCloudData(storeId) {
  const rows = await supabase.select(
    'store_data',
    `select=store_id,revision,ciphertext,iv,recovery_salt,recovery_iv,recovery_wrapped_key&store_id=eq.${encodeURIComponent(storeId)}`,
  );
  return rows[0] || null;
}

async function saveEnvelope(storeId, userId, envelope) {
  await supabase.upsert('key_envelopes', envelopePayload(storeId, userId, envelope), 'store_id,user_id');
}

function recoveryEnvelopeFromRow(row) {
  return { salt: row.recovery_salt, iv: row.recovery_iv, wrapped: row.recovery_wrapped_key };
}

function cloudDataPayload(storeId, userId, revision, encrypted, recoveryEnvelope) {
  return {
    store_id: storeId,
    revision,
    ciphertext: encrypted.ciphertext,
    iv: encrypted.iv,
    recovery_salt: recoveryEnvelope.salt,
    recovery_iv: recoveryEnvelope.iv,
    recovery_wrapped_key: recoveryEnvelope.wrapped,
    updated_by: userId,
  };
}

async function insertCloudData(storeId, userId, data, dataKey, recoveryEnvelope) {
  const encrypted = await encryptJson(dataKey, data);
  const rows = await supabase.insert('store_data', cloudDataPayload(storeId, userId, 1, encrypted, recoveryEnvelope));
  if (!rows?.length) throw new Error('Supabase tidak mengembalikan data yang disimpan.');
  return rows[0];
}

async function pushCloudData(data, revision) {
  const encrypted = await encryptJson(context.dataKey, data);
  const nextRevision = revision + 1;
  const rows = await supabase.update(
    'store_data',
    `store_id=eq.${encodeURIComponent(context.storeId)}&revision=eq.${revision}`,
    cloudDataPayload(context.storeId, context.userId, nextRevision, encrypted, context.recoveryEnvelope),
  );
  if (!rows?.length) return false;
  context.revision = nextRevision;
  rememberRevision(context.storeId, nextRevision);
  return true;
}

export async function connect(password, recoveryCode = '', { startEmpty = false } = {}) {
  const user = await supabase.getUser();
  startEmpty = startEmpty || user.user_metadata?.warungpintar_empty_vault === true;
  const membership = await getMembership(user.id);
  let cloudData = await readCloudData(membership.storeId);
  let createdCloudData = false;
  const envelopes = await supabase.select(
    'key_envelopes',
    `select=password_salt,password_iv,password_wrapped_key&store_id=eq.${encodeURIComponent(membership.storeId)}&user_id=eq.${encodeURIComponent(user.id)}`,
  );
  const previousEnvelope = envelopes[0];
  let dataKey;
  let passwordEnvelope;
  let newRecoveryCode = null;
  let recoveryEnvelope = cloudData ? recoveryEnvelopeFromRow(cloudData) : null;

  if (previousEnvelope) {
    passwordEnvelope = {
      salt: previousEnvelope.password_salt,
      iv: previousEnvelope.password_iv,
      wrapped: previousEnvelope.password_wrapped_key,
    };
    try {
      dataKey = await openPasswordEnvelope(passwordEnvelope, password);
    } catch (passwordError) {
      if (!recoveryCode || !cloudData) {
        throw new Error('Password berubah atau kunci tidak cocok. Masukkan recovery key untuk membuka data terenkripsi.');
      }
      dataKey = await openRecoveryEnvelope(recoveryEnvelope, recoveryCode);
      passwordEnvelope = await makePasswordEnvelope(dataKey, password);
      await saveEnvelope(membership.storeId, user.id, passwordEnvelope);
    }
  } else if (cloudData) {
    if (!recoveryCode) throw new Error('Masukkan recovery key yang diberikan pemilik agar asisten dapat membuka data toko.');
    dataKey = await openRecoveryEnvelope(recoveryEnvelope, recoveryCode);
    passwordEnvelope = await makePasswordEnvelope(dataKey, password);
    await saveEnvelope(membership.storeId, user.id, passwordEnvelope);
  } else {
    if (membership.role !== 'owner') throw new Error('Data toko belum siap. Minta pemilik menyiapkan sinkronisasi terlebih dahulu.');
    dataKey = await createVaultKey();
    newRecoveryCode = createRecoveryCode();
    recoveryEnvelope = await makeRecoveryEnvelope(dataKey, newRecoveryCode);
    passwordEnvelope = await makePasswordEnvelope(dataKey, password);
    await saveEnvelope(membership.storeId, user.id, passwordEnvelope);
  }

  const local = await db.configureVault(dataKey, membership.storeId, { startEmpty });
  if (!cloudData) {
    if (membership.role !== 'owner') throw new Error('Data toko belum tersedia. Hubungi pemilik.');
    newRecoveryCode ||= createRecoveryCode();
    recoveryEnvelope ||= await makeRecoveryEnvelope(dataKey, newRecoveryCode);
    cloudData = await insertCloudData(membership.storeId, user.id, local.data, dataKey, recoveryEnvelope);
    createdCloudData = true;
  }
  const remoteData = await decryptJson(dataKey, cloudData);
  context = {
    userId: user.id,
    email: user.email,
    storeId: membership.storeId,
    storeName: membership.storeName,
    role: membership.role,
    dataKey,
    passwordEnvelope,
    recoveryEnvelope,
    revision: Number(cloudData.revision) || 1,
  };
  localStorage.setItem(OFFLINE_KEY, JSON.stringify({
    userId: user.id,
    email: user.email,
    storeId: membership.storeId,
    storeName: membership.storeName,
    role: membership.role,
    passwordEnvelope,
    recoveryEnvelope,
    revision: context.revision,
  }));
  let localConflict = Boolean(!createdCloudData && local.dirty && hasLocalBusinessData(local.data));
  if (createdCloudData) {
    await db.markSynced(local.generation);
    local.dirty = false;
  } else if (!localConflict) {
    await db.replaceVaultData(remoteData);
    const restored = db.vaultSnapshot();
    await db.markSynced(restored.generation);
  }
  rememberRevision(context.storeId, context.revision);
  setStatus('Tersinkron ke cloud', 'ok');
  return {
    user,
    membership,
    recoveryCode: newRecoveryCode,
    local,
    remoteData,
    remoteRevision: context.revision,
    conflict: localConflict,
  };
}

export async function resolveInitialConflict(choice, remoteData, remoteRevision) {
  if (!context) throw new Error('Sesi belum terbuka.');
  if (choice === 'local') {
    const local = db.vaultSnapshot();
    if (!await pushCloudData(local.data, remoteRevision)) {
      throw new Error('Perangkat lain menyimpan perubahan lebih dahulu. Sinkronkan ulang sebelum memilih data lokal.');
    }
    await db.markSynced(local.generation);
  } else {
    await db.replaceVaultData(remoteData);
    const latest = db.vaultSnapshot();
    await db.markSynced(latest.generation);
    context.revision = remoteRevision;
  }
  rememberRevision(context.storeId, context.revision);
}

export function currentContext() {
  return context ? { userId: context.userId, email: context.email, storeId: context.storeId, storeName: context.storeName, role: context.role } : null;
}

export function hasOfflineAccount() {
  return Boolean(localStorage.getItem(OFFLINE_KEY));
}

export async function unlockRememberedDevice(userId) {
  const cached = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null');
  if (!cached || (userId && cached.userId !== userId)) {
    throw new Error('Perangkat ini belum disetel untuk mengingat akun tersebut.');
  }
  const remembered = await getRememberedKey(cached.userId);
  if (!remembered) throw new Error('Kunci perangkat tersimpan tidak ditemukan.');
  const dataKey = await openRememberedKey(remembered);
  await db.configureVault(dataKey, cached.storeId);
  context = {
    userId: cached.userId,
    email: cached.email,
    storeId: cached.storeId,
    storeName: cached.storeName,
    role: cached.role,
    dataKey,
    passwordEnvelope: cached.passwordEnvelope,
    recoveryEnvelope: cached.recoveryEnvelope,
    revision: cached.revision,
  };
  setStatus(navigator.onLine ? 'Sesi perangkat dipulihkan' : 'Offline — sesi perangkat dipulihkan', navigator.onLine ? 'ok' : 'warn');
  return currentContext();
}

export async function rememberCurrentDevice() {
  if (!context) throw new Error('Sesi toko belum terbuka.');
  await storeRememberedKey(context.userId, context.dataKey);
}

export async function unlockOffline(password, recoveryCode = '') {
  const cached = JSON.parse(localStorage.getItem(OFFLINE_KEY) || 'null');
  if (!cached) throw new Error('Belum ada akun yang pernah dibuka pada perangkat ini.');
  let dataKey;
  try {
    dataKey = await openPasswordEnvelope(cached.passwordEnvelope, password);
  } catch (passwordError) {
    if (!recoveryCode) throw new Error('Password tidak cocok. Masukkan password akun atau recovery key.');
    dataKey = await openRecoveryEnvelope(cached.recoveryEnvelope, recoveryCode);
  }
  await db.configureVault(dataKey, cached.storeId);
  context = {
    userId: cached.userId,
    email: cached.email,
    storeId: cached.storeId,
    storeName: cached.storeName,
    role: cached.role,
    dataKey,
    passwordEnvelope: cached.passwordEnvelope,
    recoveryEnvelope: cached.recoveryEnvelope,
    revision: cached.revision,
  };
  setStatus('Offline — tersimpan terenkripsi', 'warn');
  return currentContext();
}

export function onSyncStatus(listener) {
  syncStatusListener = listener;
}

export function onSyncError(listener) {
  syncErrorListener = listener;
}

export async function syncNow() {
  if (!context) throw new Error('Login diperlukan untuk sinkronisasi.');
  if (!navigator.onLine) {
    setStatus('Offline — perubahan tersimpan di perangkat', 'warn');
    return { offline: true };
  }
  if (syncing) return syncing;
  syncing = (async () => {
    setStatus('Menyinkronkan...', 'loading');
    const cloudData = await readCloudData(context.storeId);
    const local = db.vaultSnapshot();
    if (!cloudData) throw new Error('Data cloud toko tidak ditemukan.');
    const cloudRevision = Number(cloudData.revision);
    if (local.dirty) {
      if (cloudRevision !== context.revision) {
        pendingConflict = { data: await decryptJson(context.dataKey, cloudData), revision: cloudRevision };
        setStatus('Konflik perubahan — perlu keputusan', 'warn');
        return { conflict: true, ...pendingConflict };
      }
      if (!await pushCloudData(local.data, context.revision)) {
        const latestCloudData = await readCloudData(context.storeId);
        pendingConflict = {
          data: await decryptJson(context.dataKey, latestCloudData),
          revision: Number(latestCloudData.revision),
        };
        setStatus('Konflik perubahan — perlu keputusan', 'warn');
        return { conflict: true, ...pendingConflict };
      }
      if (!await db.markSynced(local.generation)) scheduleSync();
      setStatus('Tersinkron ke cloud', 'ok');
      return { synced: true };
    }
    if (Number(cloudData.revision) > context.revision) {
      const data = await decryptJson(context.dataKey, cloudData);
      await db.replaceVaultData(data);
      const latest = db.vaultSnapshot();
      await db.markSynced(latest.generation);
      context.revision = Number(cloudData.revision);
      rememberRevision(context.storeId, context.revision);
    }
    setStatus('Tersinkron ke cloud', 'ok');
    return { synced: true };
  })().catch((error) => {
    const networkError = /tidak dapat terhubung ke server|failed to fetch|networkerror|load failed/i.test(error?.message || '');
    if (networkError) {
      setStatus('Offline — perubahan tersimpan di perangkat', 'warn');
      return { offline: true };
    }
    setStatus('Sinkronisasi gagal', 'error');
    syncErrorListener(error);
    throw error;
  }).finally(() => { syncing = null; });
  return syncing;
}

export async function resolveSyncConflict(choice) {
  if (!context || !pendingConflict) throw new Error('Tidak ada konflik sinkronisasi.');
  if (choice === 'cloud') {
    await db.replaceVaultData(pendingConflict.data);
    const local = db.vaultSnapshot();
    await db.markSynced(local.generation);
    context.revision = pendingConflict.revision;
  } else {
    if (!await pushCloudData(db.vaultSnapshot().data, pendingConflict.revision)) {
      throw new Error('Konflik berubah lagi. Muat ulang data terbaru dan coba kembali.');
    }
    const local = db.vaultSnapshot();
    await db.markSynced(local.generation);
  }
  pendingConflict = null;
  rememberRevision(context.storeId, context.revision);
  setStatus('Tersinkron ke cloud', 'ok');
}

export function scheduleSync() {
  if (!context) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => { syncNow().catch(() => {}); }, 1200);
}

export function startAutoSync() {
  if (autoSyncStarted) return;
  autoSyncStarted = true;
  window.addEventListener('online', () => syncNow().catch(() => {}));
  window.addEventListener('focus', () => syncNow().catch(() => {}));
  setInterval(() => {
    if (document.visibilityState === 'visible') syncNow().catch(() => {});
  }, 30000);
}

export async function changeStoreName(name) {
  if (!context || context.role !== 'owner') throw new Error('Hanya pemilik yang dapat mengubah nama toko.');
  const updated = await supabase.update('stores', `id=eq.${encodeURIComponent(context.storeId)}`, { name });
  if (!updated?.length) throw new Error('Nama toko tidak dapat disimpan.');
  context.storeName = name;
}

export async function inviteAssistant(email) {
  if (!context || context.role !== 'owner') throw new Error('Hanya pemilik yang dapat mengundang asisten.');
  return supabase.inviteAssistant(email);
}

export async function listAssistants() {
  if (!context || context.role !== 'owner') throw new Error('Hanya pemilik yang dapat melihat anggota toko.');
  const result = await supabase.assistantAccess('list');
  return result.assistants || [];
}

export async function removeAssistant(userId) {
  if (!context || context.role !== 'owner') throw new Error('Hanya pemilik yang dapat menghapus akses asisten.');
  return supabase.assistantAccess('remove', userId);
}

export async function rotateRecoveryCode() {
  if (!context || context.role !== 'owner') throw new Error('Hanya pemilik yang dapat membuat recovery key.');
  const code = createRecoveryCode();
  const envelope = await makeRecoveryEnvelope(context.dataKey, code);
  const rows = await supabase.update(
    'store_data',
    `store_id=eq.${encodeURIComponent(context.storeId)}&revision=eq.${context.revision}`,
    {
      revision: context.revision + 1,
      recovery_salt: envelope.salt,
      recovery_iv: envelope.iv,
      recovery_wrapped_key: envelope.wrapped,
      updated_by: context.userId,
    },
  );
  if (!rows?.length) throw new Error('Data toko berubah di perangkat lain. Sinkronkan lalu coba lagi.');
  context.recoveryEnvelope = envelope;
  context.revision++;
  rememberRevision(context.storeId, context.revision);
  return code;
}

export async function disconnect() {
  clearTimeout(syncTimer);
  const userId = context?.userId;
  context = null;
  pendingConflict = null;
  db.lockVault();
  localStorage.removeItem(OFFLINE_KEY);
  try {
    await removeRememberedKey(userId);
  } finally {
    if (navigator.onLine) await supabase.logout();
    else supabase.clearSession();
  }
}
