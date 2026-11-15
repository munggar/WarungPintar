import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { deriveSmartKasbonAutoPolicy } from '../supabase/functions/_shared/smart-kasbon-policy.js';

test('automatic Smart Kasbon policy derives conservative capacity without manual inputs', () => {
  const policy = deriveSmartKasbonAutoPolicy({ cash_flow_30: 18000, net_profit_30: 9000 });
  assert.deepEqual(policy, {
    cash_available: 18000,
    working_capital: 9000,
    liabilities: 0,
    reserve_cash: 9000,
    max_per_customer: 562,
    max_active_customers: 5,
    max_total_receivable: 2250,
  });
});

test('negative cash flow or profit produces zero effective lending capacity', () => {
  const policy = deriveSmartKasbonAutoPolicy({ cash_flow_30: -1000, net_profit_30: -500 });
  assert.equal(policy.cash_available, 0);
  assert.equal(policy.working_capital, 0);
  assert.equal(policy.reserve_cash, 0);
  assert.equal(policy.max_total_receivable, 1);
  assert.equal(policy.max_per_customer, 1);
});

test('automatic Smart Kasbon policy rejects malformed financial data', () => {
  assert.throws(() => deriveSmartKasbonAutoPolicy(null), /tidak valid/);
  assert.throws(() => deriveSmartKasbonAutoPolicy({ cash_flow_30: 12.5, net_profit_30: 10 }), /bilangan bulat/);
  assert.throws(() => deriveSmartKasbonAutoPolicy({ cash_flow_30: 12, net_profit_30: Number.MAX_SAFE_INTEGER + 1 }), /bilangan bulat/);
});

test('SQL RPC persists automatic policy with service-role-only execution', async () => {
  const sql = await readFile(new URL('../supabase/migrations/20261115140000_auto_smart_kasbon_policy.sql', import.meta.url), 'utf8');
  assert.ok(sql.includes('create or replace function public.smart_kasbon_auto_configure'));
  assert.ok(sql.includes('grant execute on function public.smart_kasbon_auto_configure'));
  assert.ok(sql.includes('to service_role'));
  assert.ok(sql.includes('from public, anon, authenticated'));
});
