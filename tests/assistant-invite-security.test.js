import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  registerAssistantWithInvite,
  validateAssistantRegistrationPayload,
} from '../supabase/functions/_shared/assistant-invite-security.js';

const validPayload = {
  email: ' Assistant@example.com ',
  password: 'secure-password',
  invite_code: 'A'.repeat(64),
};

function createClients({ reservation = 'reservation-1', allowed = true, createError = null } = {}) {
  const calls = [];
  const admin = {
    async rpc(name, payload) {
      calls.push({ kind: 'rpc', name, payload });
      if (name === 'reserve_store_invite') return { data: reservation, error: null };
      if (name === 'consume_password_reset_attempt') return { data: allowed, error: null };
      if (name === 'complete_store_invite') return { data: true, error: null };
      if (name === 'release_store_invite') return { data: true, error: null };
      throw new Error(`Unexpected RPC: ${name}`);
    },
    auth: { admin: {
      async createUser(attributes) {
        calls.push({ kind: 'createUser', attributes });
        return createError
          ? { data: { user: null }, error: createError }
          : { data: { user: { id: 'assistant-1' } }, error: null };
      },
      async deleteUser(userId) {
        calls.push({ kind: 'deleteUser', userId });
        return { error: null };
      },
    } },
  };
  const userClient = { auth: { async signInWithPassword(credentials) {
    calls.push({ kind: 'signInWithPassword', credentials });
    return { data: { session: { access_token: 'assistant-access', refresh_token: 'assistant-refresh' } }, error: null };
  } } };
  return { admin, userClient, calls };
}

test('assistant signup requires a valid code, password, and email without accepting a role field', () => {
  const parsed = validateAssistantRegistrationPayload({ ...validPayload, role: 'owner' });
  assert.equal(parsed.ok, true);
  assert.deepEqual(parsed.value, {
    email: 'assistant@example.com',
    password: 'secure-password',
    inviteCode: 'a'.repeat(64),
  });
  assert.equal(validateAssistantRegistrationPayload({ ...validPayload, invite_code: 'invalid' }).status, 403);
  assert.equal(validateAssistantRegistrationPayload({ ...validPayload, password: 'short' }).status, 400);
  assert.equal(validateAssistantRegistrationPayload({ ...validPayload, email: 'invalid' }).status, 400);
});

test('assistant code creates only assistant membership and is atomically consumed', async () => {
  const { admin, userClient, calls } = createClients();
  const result = await registerAssistantWithInvite({
    admin,
    userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateAssistantRegistrationPayload(validPayload).value,
  });
  assert.equal(result.status, 200);
  const createCall = calls.find((call) => call.kind === 'createUser');
  assert.deepEqual(createCall.attributes.user_metadata, {
    assistant_invite_reservation_id: 'reservation-1',
  });
  assert.equal(createCall.attributes.email_confirm, true);
  assert.deepEqual(calls.map((call) => call.kind === 'rpc' ? call.name : call.kind), [
    'reserve_store_invite',
    'consume_password_reset_attempt',
    'createUser',
    'signInWithPassword',
    'complete_store_invite',
  ]);
});

test('invalid, rate-limited, or duplicate assistant registrations cannot create accounts', async () => {
  const invalidInvite = createClients({ reservation: null });
  const rejected = await registerAssistantWithInvite({
    admin: invalidInvite.admin,
    userClient: invalidInvite.userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateAssistantRegistrationPayload(validPayload).value,
  });
  assert.equal(rejected.status, 403);
  assert.equal(invalidInvite.calls.some((call) => call.kind === 'createUser'), false);

  const limited = createClients({ allowed: false });
  const limitedResult = await registerAssistantWithInvite({
    admin: limited.admin,
    userClient: limited.userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateAssistantRegistrationPayload(validPayload).value,
  });
  assert.equal(limitedResult.status, 429);
  assert.equal(limited.calls.some((call) => call.kind === 'createUser'), false);
  assert.equal(limited.calls.some((call) => call.name === 'release_store_invite'), true);

  const duplicate = createClients({ createError: Object.assign(new Error('duplicate user'), { status: 422, code: 'email_exists' }) });
  const duplicateResult = await registerAssistantWithInvite({
    admin: duplicate.admin,
    userClient: duplicate.userClient,
    rateLimitSecret: 'a'.repeat(32),
    ...validateAssistantRegistrationPayload(validPayload).value,
  });
  assert.equal(duplicateResult.status, 400);
  assert.equal(duplicate.calls.some((call) => call.kind === 'signInWithPassword'), false);
  assert.equal(duplicate.calls.some((call) => call.name === 'release_store_invite'), true);
});
