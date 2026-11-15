import { readFile } from 'node:fs/promises';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerOwner,
  validateOwnerRegistrationPayload,
} from '../supabase/functions/_shared/registration-security.js';

const validPayload = {
  email: ' Owner@example.com ',
  password: 'secure-password',
  store_name: 'Warung A',
};

function createClients({
  registrationAllowed = true,
  createUser = {
    data: { user: { id: 'owner-1' } },
    error: null,
  },
  login = {
    data: {
      session: { access_token: 'test-access-token', refresh_token: 'test-refresh-token' },
    },
    error: null,
  },
  createUserThrows = false,
} = {}) {
  const calls = [];
  const admin = {
    async rpc(name, payload) {
      calls.push({ type: 'rpc', name, payload });
      if (name === 'consume_owner_registration_attempt') return { data: registrationAllowed, error: null };
      if (name === 'reserve_owner_registration_invite') return { data: 'legacy-reservation', error: null };
      if (name === 'complete_owner_registration_invite') return { data: true, error: null };
      if (name === 'release_owner_registration_invite') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    auth: {
      admin: {
        async createUser(attributes) {
          calls.push({ type: 'createUser', attributes });
          if (createUserThrows) throw new Error('network outcome unknown');
          return createUser;
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

test('hosted Auth config keeps public signup disabled and email confirmation disabled', async () => {
  const config = await readFile(new URL('../supabase/config.toml', import.meta.url), 'utf8');
  assert.match(config, /^\[auth\]\s*\r?\n\s*enable_signup\s*=\s*false\s*$/m);
  assert.match(config, /^\[auth\.email\]\s*\r?\n\s*enable_confirmations\s*=\s*false\s*$/m);
});

test('validates owner registration without an administrator invite and ignores client-supplied role metadata', () => {
  const parsed = validateOwnerRegistrationPayload({
    ...validPayload,
    role: 'admin',
    app_metadata: { warungpintar_account_type: 'admin' },
  });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    email: 'owner@example.com',
    password: 'secure-password',
    storeName: 'Warung A',
  });
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, email: 'invalid' }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, password: 'short' }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, password: 'x'.repeat(129) }).status, 400);
  assert.equal(validateOwnerRegistrationPayload({ ...validPayload, store_name: '' }).status, 400);
});

test('owner registration rate-limits, sets a server-only owner marker, and creates an immediate password session', async () => {
  const parsed = validateOwnerRegistrationPayload(validPayload);
  const { admin, userClient, calls } = createClients();

  const result = await registerOwner({
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
  });
  assert.deepEqual(createCall.attributes.app_metadata, {
    warungpintar_account_type: 'owner',
  });
  assert.equal(createCall.attributes.email_confirm, true);
  assert.deepEqual(calls.map((call) => call.type), ['rpc', 'createUser', 'signInWithPassword']);
  assert.deepEqual(calls.filter((call) => call.type === 'rpc').map((call) => call.name), [
    'consume_owner_registration_attempt',
  ]);
  assert.equal(calls.filter((call) => call.type === 'rpc').some((call) => call.name.includes('owner_invite')), false);
});

test('owner registration rate limit blocks Auth user creation', async () => {
  const { admin, userClient, calls } = createClients({ registrationAllowed: false });
  const result = await registerOwner({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });
  assert.equal(result.status, 429);
  assert.equal(calls.some((call) => call.type === 'createUser'), false);
  const rateLimitCall = calls.find((call) => call.name === 'consume_owner_registration_attempt');
  assert.match(rateLimitCall.payload.p_email_hash, /^[0-9a-f]{64}$/);
});

test('duplicate or invalid Auth account creation returns a safe rejection without logging the user in', async () => {
  const { admin, userClient, calls } = createClients({
    createUser: {
      data: { user: null },
      error: Object.assign(new Error('duplicate user'), { status: 422, code: 'email_exists' }),
    },
  });
  const result = await registerOwner({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });
  assert.equal(result.status, 400);
  assert.equal(result.body.code, 'registration_not_completed');
  assert.equal(calls.some((call) => call.type === 'signInWithPassword'), false);
});

test('ambiguous Auth create result is not compensated or retried automatically', async () => {
  const { admin, userClient, calls } = createClients({ createUserThrows: true });
  const result = await registerOwner({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'registration_outcome_unknown');
  assert.equal(calls.some((call) => call.type === 'signInWithPassword'), false);
  assert.equal(calls.some((call) => call.type === 'deleteUser'), false);
});

test('account is not deleted if password session issuance fails after Auth creation', async () => {
  const { admin, userClient, calls } = createClients({
    login: { data: { session: null }, error: new Error('session unavailable') },
  });
  const result = await registerOwner({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateOwnerRegistrationPayload(validPayload).value,
  });
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'registration_session_unavailable');
  assert.equal(calls.some((call) => call.type === 'deleteUser'), false);
});

test('legacy cached owner signup can finish a previously issued invitation during rollout', async () => {
  const { admin, userClient, calls } = createClients();
  const parsed = validateOwnerRegistrationPayload({
    ...validPayload,
    invite_code: 'A'.repeat(64),
  });
  assert.equal(parsed.ok, true);
  const result = await registerOwner({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...parsed.value,
  });
  assert.equal(result.status, 200);
  const createCall = calls.find((call) => call.type === 'createUser');
  assert.equal(createCall.attributes.user_metadata.owner_invite_reservation_id, 'legacy-reservation');
  assert.equal(calls.some((call) => call.name === 'complete_owner_registration_invite'), true);
});
