import test from 'node:test';
import assert from 'node:assert/strict';
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
