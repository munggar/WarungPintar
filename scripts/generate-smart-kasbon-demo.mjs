import { createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const SEED = 20261114;
const DEMO_MARKER = 'SYNTHETIC_SMART_KASBON_DEMO_V1';
const TRAINING_CUSTOMERS = 400;
const EVALUATION_CUSTOMERS = 100;
const LOANS_PER_CUSTOMER = 2;
const IMMATURE_LOANS = 30;

function randomGenerator(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function uuid(name) {
  const hex = createHash('sha256').update(`${DEMO_MARKER}:${name}`).digest('hex').slice(0, 32).split('');
  hex[12] = '5';
  hex[16] = ((parseInt(hex[16], 16) & 3) | 8).toString(16);
  const value = hex.join('');
  return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`;
}

function dateOnly(date) {
  return date.toISOString().slice(0, 10);
}

function addDays(date, days) {
  const result = new Date(date);
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function healthFor(random, ability) {
  const options = ability > 0.7
    ? ['sangat_sehat', 'sehat', 'stabil']
    : ability < -0.7
      ? ['kritis', 'menurun', 'stagnan']
      : ['stabil', 'sehat', 'stagnan', 'cold_start'];
  return options[Math.floor(random() * options.length)];
}

function makeLoan(random, customer, index, issuedAt, ability, previousLate, immature = false) {
  const amount = Math.round((25000 + random() * 575000) / 5000) * 5000;
  const termDays = [7, 14, 21, 30, 45, 60][Math.floor(random() * 6)];
  const dueDate = immature
    ? addDays(new Date('2026-11-20T00:00:00.000Z'), Math.floor(random() * 20))
    : addDays(issuedAt, termDays);
  const noise = (random() - 0.5) * 24;
  const riskScore = Math.max(8, Math.min(96, Math.round(50 + ability * 17 + noise - previousLate * 9)));
  const overdueRatio = previousLate ? [0.08, 0.17, 0.32][Math.floor(random() * 3)] : 0;
  const margin = Math.max(-0.25, Math.min(0.45, ability * 0.07 + (random() - 0.5) * 0.2));
  const salesTrend = Math.max(-0.8, Math.min(1.0, ability * 0.18 + (random() - 0.5) * 0.7));
  const profitTrend = Math.max(-0.8, Math.min(1.0, ability * 0.15 + (random() - 0.5) * 0.7));
  const cashFlow = Math.round((ability * 45000 + (random() - 0.5) * 280000) / 1000) * 1000;
  const health = healthFor(random, ability + (random() - 0.5));
  const decisionFeatures = {
    risk_score: riskScore,
    risk: riskScore >= 70 && overdueRatio === 0 ? 'rendah' : riskScore < 45 || overdueRatio > 0.2 ? 'tinggi' : 'sedang',
    health,
    metrics: {
      margin_30: margin,
      sales_trend_30: salesTrend,
      profit_trend_30: profitTrend,
      cash_flow_30: cashFlow,
      overdue_ratio: overdueRatio,
      snapshot_fresh: random() > 0.12,
    },
    synthetic_demo: DEMO_MARKER,
  };
  const loan = {
    id: uuid(`loan:${customer}:${index}`),
    customer_id: uuid(`customer:${customer}`),
    amount,
    paid_amount: 0,
    due_date: dateOnly(dueDate),
    created_at: issuedAt.toISOString(),
    status: 'active',
    settled_at: null,
    decision_features: decisionFeatures,
  };
  if (immature) return { loan, payments: [], intendedLabel: null, ability };

  const timelyProbability = sigmoid((riskScore - 50) * 0.075 + (margin - 0.08) * 0.7
    + (decisionFeatures.metrics.snapshot_fresh ? 0.12 : -0.12));
  const onTime = random() < timelyProbability;
  const paymentCount = [1, 1, 2, 2, 3][Math.floor(random() * 5)];
  const payments = [];
  let paid = 0;
  const firstPayment = Math.max(1000, Math.floor(amount * (paymentCount === 1 ? 1 : 0.25 + random() * 0.35)));
  if (paymentCount > 1 && !onTime) {
    paid = firstPayment;
    payments.push({
      id: uuid(`payment:${customer}:${index}:1`),
      loan_id: loan.id,
      amount: firstPayment,
      paid_at: addDays(dueDate, -Math.floor(random() * Math.max(termDays, 2))).toISOString(),
    });
  }
  const remainingPayments = paymentCount - payments.length;
  let finalPaidAt;
  if (onTime) {
    const daysEarly = Math.floor(random() * Math.min(termDays, 10));
    finalPaidAt = addDays(dueDate, -daysEarly);
  } else {
    finalPaidAt = addDays(dueDate, 1 + Math.floor(random() * 30));
  }
  for (let paymentIndex = 0; paymentIndex < remainingPayments; paymentIndex += 1) {
    const paymentAmount = paymentIndex === remainingPayments - 1
      ? amount - paid
      : Math.max(1000, Math.floor((amount - paid) / (remainingPayments - paymentIndex)));
    paid += paymentAmount;
    const paymentDate = paymentIndex === remainingPayments - 1
      ? finalPaidAt
      : addDays(finalPaidAt, -Math.floor(random() * 4 + 1));
    payments.push({
      id: uuid(`payment:${customer}:${index}:${payments.length + 1}`),
      loan_id: loan.id,
      amount: paymentAmount,
      paid_at: paymentDate.toISOString(),
    });
  }
  payments.sort((left, right) => left.paid_at.localeCompare(right.paid_at));
  loan.paid_amount = payments.reduce((total, payment) => total + payment.amount, 0);
  loan.settled_at = payments[payments.length - 1].paid_at;
  return { loan, payments, intendedLabel: onTime ? 1 : 0, ability };
}

export function generateSmartKasbonDemoDataset() {
  const random = randomGenerator(SEED);
  const loans = [];
  const payments = [];
  const customers = [];
  const labels = [];
  const start = new Date('2023-01-01T03:00:00.000Z');
  const trainCustomerAbilities = Array.from({ length: TRAINING_CUSTOMERS }, () => (random() + random() + random() - 1.5) * 2.4);
  const evaluationCustomerAbilities = Array.from({ length: EVALUATION_CUSTOMERS }, () => (random() + random() + random() - 1.5) * 2.4);
  const groups = [
    { prefix: 'train', abilities: trainCustomerAbilities, customerCount: TRAINING_CUSTOMERS, group: 'training' },
    { prefix: 'holdout', abilities: evaluationCustomerAbilities, customerCount: EVALUATION_CUSTOMERS, group: 'evaluation' },
  ];

  for (const { prefix, abilities, customerCount, group } of groups) {
    for (let customerIndex = 0; customerIndex < customerCount; customerIndex += 1) {
      const customerKey = `${prefix}-${String(customerIndex + 1).padStart(3, '0')}`;
      const ability = abilities[customerIndex];
      let previousLate = 0;
      for (let loanIndex = 0; loanIndex < LOANS_PER_CUSTOMER; loanIndex += 1) {
        const sequence = group === 'training'
          ? customerIndex * LOANS_PER_CUSTOMER + loanIndex
          : TRAINING_CUSTOMERS * LOANS_PER_CUSTOMER + customerIndex * LOANS_PER_CUSTOMER + loanIndex;
        const issuedAt = addDays(start, sequence);
        const generated = makeLoan(random, customerKey, loanIndex + 1, issuedAt, ability, previousLate);
        loans.push(generated.loan);
        payments.push(...generated.payments);
        labels.push({ group, customerKey, label: generated.intendedLabel });
        previousLate = generated.intendedLabel === 0 ? Math.min(2, previousLate + 1) : Math.max(0, previousLate - 1);
      }
      customers.push({ customer_id: uuid(`customer:${customerKey}`), split: group, loan_count: LOANS_PER_CUSTOMER });
    }
  }

  const immatureStart = new Date('2026-10-15T03:00:00.000Z');
  for (let index = 0; index < IMMATURE_LOANS; index += 1) {
    const customerKey = `immature-${String(index + 1).padStart(3, '0')}`;
    const generated = makeLoan(random, customerKey, 1, addDays(immatureStart, index), (random() - 0.5) * 2, 0, true);
    loans.push(generated.loan);
    customers.push({ customer_id: generated.loan.customer_id, split: 'immature', loan_count: 1 });
  }

  loans.sort((left, right) => Date.parse(left.created_at) - Date.parse(right.created_at));
  payments.sort((left, right) => left.paid_at.localeCompare(right.paid_at));
  const classCounts = labels.reduce((counts, row) => {
    counts[row.group][row.label === 1 ? 'on_time' : 'late'] += 1;
    return counts;
  }, {
    training: { on_time: 0, late: 0 },
    evaluation: { on_time: 0, late: 0 },
  });

  return {
    metadata: {
      synthetic: true,
      marker: DEMO_MARKER,
      seed: SEED,
      generated_at: '2026-11-14T05:00:00.000Z',
      as_of: '2026-11-14T05:00:00.000Z',
      training_customers: TRAINING_CUSTOMERS,
      evaluation_customers: EVALUATION_CUSTOMERS,
      immature_loans: IMMATURE_LOANS,
      intended_class_counts: classCounts,
      loan_count: loans.length,
      eligible_loan_count: labels.length,
      payment_count: payments.length,
      note: 'Entire dataset is generated synthetic test data; never use as a production training source.',
    },
    customers,
    loans,
    payments,
  };
}

async function main() {
  const outputArgument = process.argv.find((argument) => argument.startsWith('--output='));
  if (!outputArgument) throw new Error('Provide --output=<absolute path> for the generated demo dataset.');
  const outputPath = path.resolve(ROOT, outputArgument.slice('--output='.length));
  const dataset = generateSmartKasbonDemoDataset();
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({
    output: outputPath,
    metadata: dataset.metadata,
    distinct_customers: dataset.customers.length,
  }, null, 2));
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : 'Dataset generation failed.');
    process.exitCode = 1;
  });
}
