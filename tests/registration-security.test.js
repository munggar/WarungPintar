import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerOwnerWithInvite,
  validateOwnerRegistrationPayload,
} from '../supabase/functions/_shared/registration-security.js';

const validPayload = {
  email: ' Owner@example.com ',
  password: 'secure-password',
  store_name: 'Warung A',
  invite_code: 'A'.repeat(64),
};

function createClients({
  reservation = 'reservation-1',
  createUser = {
    data: { user: { id: 'owner-1' } },
    error: null,
  },
  registrationAllowed = true,
  login = {
    data: {
      session: { access_token: 'test-access-token', refresh_token: 'test-refresh-token' },
    },
    error: null,
  },
  complete = { data: true, error: null },
} = {}) {
  const calls = [];
  const admin = {
    async rpc(name, payload) {
      calls.push({ type: 'rpc', name, payload });
      if (name === 'reserve_owner_registration_invite') return { data: reservation, error: null };
      if (name === 'consume_owner_registration_attempt') return { data: registrationAllowed, error: null };
      if (name === 'complete_owner_registration_invite') return complete;
      if (name === 'release_owner_registration_invite') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    auth: {
      admin: {
        async createUser(attributes) {
          calls.push({ type: 'createUser', attributes });
          return createUser;
        },
        async deleteUser(userId) {
          calls.push({ type: 'deleteUser', userId });
          return { error: null };
        },
      },
    },
  };
  const userClient = {
    auth: {
      async signInWithPassword(credentials) {
        calls.push({ type: 'signInWithPassword', credentials });
        return login;
      },
    },
  };
  return { admin, userClient, calls };
}

test('hosted Auth config disables public signup and email confirmation', async () => {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /^\[auth\]\s*\r?\n\s*enable_signup\s*=\s*false\s*$/m);
  assert.match(config, /^\[auth\.email\]\s*\r?\n\s*enable_confirmations\s*=\s*false\s*$/m);
});

test('validates email, password, store name, and invite before account creation', () => {
  const parsed = validateOwnerRegistrationPayload(validPayload);
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    email: 'owner@example.com',
    password: 'secure-password',
    storeName: 'Warung A',
    inviteCode: 'a'.repeat(64),
  });
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, email: 'invalid' }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, password: 'short' }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, password: 'x'.repeat(129) }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, store_name: '' }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, invite_code: 'invalid' }).status, 403);
});

test('owner invite creates a user, obtains a password session, and consumes the invite', async () => {
  const parsed = validateOwnerRegistrationPayload({ ...validPayload, role: 'admin' });
  const { admin, userClient, calls } = createClients();

  const result = await registerOwnerWithInvite({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...parsed.value,
  });

  assert.equal(result.status, 200);
  assert.deepEqual(result.body, {
    access_token: 'test-access-token',
    refresh_token: 'test-refresh-token',
  });
  const createCall = calls.find((call) => call.type === 'createUser');
  assert.deepEqual(createCall.attributes.user_metadata, {
    store_name: 'Warung A',
    warungpintar_empty_vault: true,
    owner_invite_reservation_id: 'reservation-1',
  });
  assert.equal(createCall.attributes.email_confirm, true);
  assert.deepEqual(calls.map((call) => call.type), [
    'rpc',
    'rpc',
    'createUser',
    'rpc',
    'signInWithPassword',
  ]);
  assert.deepEqual(calls.filter((call) => call.type === 'rpc').map((call) => call.name), [
    'consume_owner_registration_attempt',
    'reserve_owner_registration_invite',
    'complete_owner_registration_invite',
  ]);
  assert.equal(calls.some((call) => /otp|verify|resend|email/i.test(call.type)), false);
});

test('invalid owner invitation prevents user creation', async () => {
  const { admin, userClient, calls } = createClients({ reservation: null });

  const result = await registerOwnerWithInvite({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });

  assert.equal(result.status, 403);
  assert.equal(calls.some((call) => call.type === 'createUser'), false);
  assert.equal(calls.some((call) => call.type === 'signInWithPassword'), false);
});

test('owner registration rate limit blocks account creation before reserving the invite', async () => {
  const { admin, userClient, calls } = createClients({ registrationAllowed: false });

  const result = await registerOwnerWithInvite({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });

  assert.equal(result.status, 429);
  assert.equal(calls.some((call) => call.type === 'createUser'), false);
  assert.equal(calls.some((call) => call.name === 'reserve_owner_registration_invite'), false);
  assert.equal(calls.some((call) => call.name === 'release_owner_registration_invite'), false);
  const rateLimitCall = calls.find((call) => call.name === 'consume_owner_registration_attempt');
  assert.match(rateLimitCall.payload.p_email_hash, /^[0-9a-f]{64}$/);
});

test('duplicate email is rejected and the owner invite reservation is released', async () => {
  const { admin, userClient, calls } = createClients({
    createUser: { data: { user: null }, error: Object.assign(new Error('duplicate user'), { status: 422, code: 'email_exists' }) },
  });

  const result = await registerOwnerWithInvite({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });

  assert.equal(result.status, 400);
  assert.equal(calls.some((call) => call.type === 'signInWithPassword'), false);
  assert.equal(calls.some((call) => call.name === 'release_owner_registration_invite'), true);
});

test('missing session after completed registration preserves the created account and consumed invite', async () => {
  const { admin, userClient, calls } = createClients({
    login: { data: { session: null }, error: new Error('session unavailable') },
  });

  const result = await registerOwnerWithInvite({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });

  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'registration_session_unavailable');
  assert.equal(calls.some((call) => call.type === 'deleteUser'), false);
  assert.equal(calls.some((call) => call.name === 'complete_owner_registration_invite'), true);
  assert.equal(calls.some((call) => call.name === 'release_owner_registration_invite'), false);
});
