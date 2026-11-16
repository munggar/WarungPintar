import { SMART_KASBON_FEATURE_NAMES } from './smart-kasbon-model.js';

export const SMART_KASBON_DEMO_MARKER = 'SYNTHETIC_SMART_KASBON_DEMO_V1';
const HEALTH_STATES = [
  'cold_start', 'kritis', 'menurun', 'stagnan', 'sangat_sehat', 'sehat', 'stabil',
];

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

function sigmoid(value) {
  return 1 / (1 + Math.exp(-value));
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function customerAbility(random) {
  return (random() + random() + random() - 1.5) * 2.4;
}

function healthFor(random, ability) {
  const choices = ability > 0.7
    ? ['sangat_sehat', 'sehat', 'stabil']
    : ability < -0.7
      ? ['kritis', 'menurun', 'stagnan']
      : ['stabil', 'sehat', 'stagnan', 'cold_start'];
  return choices[Math.floor(random() * choices.length)];
}

/**
 * Generates a clearly synthetic, anonymized dataset for the isolated demo tenant.
 * Customer group IDs are synthetic labels, never real customer identifiers.
 */
export function generateSmartKasbonDemoTrainingExamples({
  seed = 20261116,
  generatedAt = Date.now(),
  trainingCustomers = 400,
  evaluationCustomers = 100,
  loansPerCustomer = 2,
} = {}) {
  if (!Number.isSafeInteger(seed) || !Number.isFinite(generatedAt)
    || trainingCustomers < 100 || evaluationCustomers < 10
    || loansPerCustomer < 1 || loansPerCustomer > 10) {
    throw new TypeError('Konfigurasi dataset demo tidak valid.');
  }
  const random = randomGenerator(seed);
  const examples = [];
  const start = Date.parse('2023-01-01T03:00:00.000Z');
  const groups = [
    { prefix: 'synthetic-training', count: trainingCustomers },
    { prefix: 'synthetic-evaluation', count: evaluationCustomers },
  ];
  let sequence = 0;

  for (const group of groups) {
    for (let customerIndex = 0; customerIndex < group.count; customerIndex += 1) {
      const customerGroup = `${group.prefix}-${String(customerIndex + 1).padStart(4, '0')}`;
      const ability = customerAbility(random);
      let previousLate = 0;

      for (let loanIndex = 0; loanIndex < loansPerCustomer; loanIndex += 1) {
        const amount = Math.round((25000 + random() * 575000) / 5000) * 5000;
        const termDays = [7, 14, 21, 30, 45, 60][Math.floor(random() * 6)];
        const riskScore = clamp(Math.round(50 + ability * 17 + (random() - 0.5) * 24
          - previousLate * 9), 8, 96);
        const overdueRatio = previousLate
          ? [0.08, 0.17, 0.32][Math.floor(random() * 3)]
          : 0;
        const margin = clamp(ability * 0.07 + (random() - 0.5) * 0.2, -0.25, 0.45);
        const salesTrend = clamp(ability * 0.18 + (random() - 0.5) * 0.7, -0.8, 1);
        const profitTrend = clamp(ability * 0.15 + (random() - 0.5) * 0.7, -0.8, 1);
        const cashFlow = Math.round((ability * 45000 + (random() - 0.5) * 280000) / 1000) * 1000;
        const snapshotFresh = random() > 0.12;
        const health = healthFor(random, ability + (random() - 0.5));
        const features = [
          Math.log1p(amount),
          termDays,
          riskScore,
          margin,
          salesTrend,
          profitTrend,
          clamp(cashFlow / amount, -10, 10),
          overdueRatio,
          snapshotFresh ? 1 : 0,
          ...HEALTH_STATES.map((state) => state === health ? 1 : 0),
        ];
        if (features.length !== SMART_KASBON_FEATURE_NAMES.length || !features.every(Number.isFinite)) {
          throw new TypeError('Fitur dataset demo tidak valid.');
        }

        const outcomeScore = (riskScore - 50) * 0.12
          + (margin - 0.08) * 3
          + salesTrend * 0.45
          + profitTrend * 0.35
          - overdueRatio * 6
          + (snapshotFresh ? 0.3 : -0.3)
          + (health === 'sangat_sehat' ? 0.35 : health === 'kritis' ? -0.45 : 0)
          + (random() - 0.5) * 0.7;
        const label = random() < sigmoid(outcomeScore) ? 1 : 0;
        examples.push({
          customerGroup,
          issuedAt: start + sequence * 86_400_000,
          features,
          label,
        });
        sequence += 1;
        previousLate = label === 0 ? Math.min(2, previousLate + 1) : Math.max(0, previousLate - 1);
      }
    }
  }

  examples.sort((left, right) => left.issuedAt - right.issuedAt);
  return {
    marker: SMART_KASBON_DEMO_MARKER,
    synthetic: true,
    seed,
    generated_at: new Date(generatedAt).toISOString(),
    training_customers: trainingCustomers,
    evaluation_customers: evaluationCustomers,
    training_count_expected: trainingCustomers * loansPerCustomer,
    evaluation_count_expected: evaluationCustomers * loansPerCustomer,
    examples,
  };
}
