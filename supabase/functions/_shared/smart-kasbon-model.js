export const SMART_KASBON_MODEL_ALGORITHM = 'logistic_regression';
export const SMART_KASBON_FEATURE_VERSION = 'smart-kasbon-v1';
export const SMART_KASBON_MODEL_MINIMUMS = Object.freeze({
  trainingRows: 100,
  evaluationRows: 40,
  trainingPerClass: 25,
  evaluationPerClass: 10,
  evaluationCustomers: 10,
});
export const SMART_KASBON_MODEL_MINIMUM_ENV = Object.freeze({
  trainingRows: 'SMART_KASBON_ML_MIN_TRAINING_ROWS',
  evaluationRows: 'SMART_KASBON_ML_MIN_EVALUATION_ROWS',
  trainingPerClass: 'SMART_KASBON_ML_MIN_TRAINING_PER_CLASS',
  evaluationPerClass: 'SMART_KASBON_ML_MIN_EVALUATION_PER_CLASS',
  evaluationCustomers: 'SMART_KASBON_ML_MIN_EVALUATION_CUSTOMERS',
});

const HEALTH_STATES = Object.freeze([
  'cold_start',
  'kritis',
  'menurun',
  'stagnan',
  'sangat_sehat',
  'sehat',
  'stabil',
]);

export const SMART_KASBON_FEATURE_NAMES = Object.freeze([
  'log_amount',
  'term_days',
  'risk_score',
  'margin_30',
  'sales_trend_30',
  'profit_trend_30',
  'cash_flow_to_amount',
  'overdue_ratio',
  'snapshot_fresh',
  ...HEALTH_STATES.map((state) => `health_${state}`),
]);

/**
 * @typedef {{trainingRows: number, evaluationRows: number, trainingPerClass: number,
 * evaluationPerClass: number, evaluationCustomers: number}} SmartKasbonModelMinimums
 */

/** @param {Record<string, string | undefined>} [values] */
export function resolveSmartKasbonModelMinimums(values = {}) {
  const result = {
    trainingRows: SMART_KASBON_MODEL_MINIMUMS.trainingRows,
    evaluationRows: SMART_KASBON_MODEL_MINIMUMS.evaluationRows,
    trainingPerClass: SMART_KASBON_MODEL_MINIMUMS.trainingPerClass,
    evaluationPerClass: SMART_KASBON_MODEL_MINIMUMS.evaluationPerClass,
    evaluationCustomers: SMART_KASBON_MODEL_MINIMUMS.evaluationCustomers,
  };
  const maximums = {
    trainingRows: 10000,
    evaluationRows: 2000,
    trainingPerClass: 5000,
    evaluationPerClass: 1000,
    evaluationCustomers: 5000,
  };
  for (const [key, environmentName] of Object.entries(SMART_KASBON_MODEL_MINIMUM_ENV)) {
    const raw = values[environmentName];
    const value = raw == null || raw === '' ? SMART_KASBON_MODEL_MINIMUMS[key] : Number(raw);
    if (!Number.isSafeInteger(value) || value < SMART_KASBON_MODEL_MINIMUMS[key]
      || value > maximums[key]) {
      throw new TypeError(`${environmentName} must be within the safe configured range.`);
    }
    result[key] = value;
  }
  if (result.trainingRows < result.trainingPerClass * 2
    || result.evaluationRows < result.evaluationPerClass * 2
    || result.evaluationCustomers < 2) {
    throw new TypeError('Model minimums cannot satisfy both-class and independent-customer requirements.');
  }
  return Object.freeze(result);
}

function finiteNumber(value, name) {
  if (value == null || value === '' || (typeof value !== 'number' && typeof value !== 'string')) {
    throw new TypeError(`${name} must be a finite number.`);
  }
  const number = Number(value);
  if (!Number.isFinite(number)) throw new TypeError(`${name} must be finite.`);
  return number;
}

function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}

function dateOnlyMilliseconds(value) {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new TypeError('due_date must be an ISO date.');
  }
  const milliseconds = Date.parse(`${value}T00:00:00+07:00`);
  if (!Number.isFinite(milliseconds) || new Date(milliseconds + 7 * 60 * 60 * 1000).toISOString().slice(0, 10) !== value) {
    throw new TypeError('due_date must be a real calendar date.');
  }
  return milliseconds;
}

export function smartKasbonFeatureVector({ amount, due_date, created_at, decision_features }) {
  const amountValue = finiteNumber(amount, 'amount');
  if (!Number.isSafeInteger(amountValue) || amountValue <= 0) throw new TypeError('amount must be a positive safe integer.');
  const issuedAt = Date.parse(created_at);
  if (!Number.isFinite(issuedAt)) throw new TypeError('created_at must be a valid timestamp.');
  const issuedDateJakarta = new Date(issuedAt + 7 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const issuedDay = Date.parse(`${issuedDateJakarta}T00:00:00Z`);
  const dueDay = Date.parse(`${due_date}T00:00:00Z`);
  dateOnlyMilliseconds(due_date);
  const termDays = (dueDay - issuedDay) / 86_400_000;
  if (termDays < 0) throw new TypeError('due_date cannot precede created_at.');

  if (!decision_features || typeof decision_features !== 'object' || Array.isArray(decision_features)) {
    throw new TypeError('decision_features are required.');
  }
  const metrics = decision_features.metrics;
  if (!metrics || typeof metrics !== 'object' || Array.isArray(metrics)) {
    throw new TypeError('decision metrics are required.');
  }
  const health = decision_features.health;
  if (!HEALTH_STATES.includes(health)) throw new TypeError('health state is invalid.');
  if (typeof metrics.snapshot_fresh !== 'boolean') throw new TypeError('snapshot_fresh must be boolean.');

  const riskScore = finiteNumber(decision_features.risk_score, 'risk_score');
  if (riskScore < 0 || riskScore > 100) throw new TypeError('risk_score is outside its valid range.');
  const margin = clamp(finiteNumber(metrics.margin_30, 'margin_30'), -1, 1);
  const salesTrend = clamp(finiteNumber(metrics.sales_trend_30, 'sales_trend_30'), -2, 2);
  const profitTrend = clamp(finiteNumber(metrics.profit_trend_30, 'profit_trend_30'), -2, 2);
  const cashFlow = finiteNumber(metrics.cash_flow_30, 'cash_flow_30');
  const overdueRatio = clamp(finiteNumber(metrics.overdue_ratio, 'overdue_ratio'), 0, 1);

  return [
    Math.log1p(amountValue),
    clamp(termDays, 0, 3650),
    riskScore,
    margin,
    salesTrend,
    profitTrend,
    clamp(cashFlow / amountValue, -10, 10),
    overdueRatio,
    metrics.snapshot_fresh ? 1 : 0,
    ...HEALTH_STATES.map((state) => state === health ? 1 : 0),
  ];
}

function jakartaDueDeadline(dueDate) {
  if (typeof dueDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dueDate)) return NaN;
  try {
    dateOnlyMilliseconds(dueDate);
  } catch {
    return NaN;
  }
  const deadline = Date.parse(`${dueDate}T23:59:59.999+07:00`);
  if (!Number.isFinite(deadline)) return NaN;
  return deadline;
}

export function buildSmartKasbonTrainingDataset(loans, payments, asOf = Date.now()) {
  if (!Array.isArray(loans) || !Array.isArray(payments) || !Number.isFinite(asOf)) {
    throw new TypeError('Loans, payments, and a valid as-of time are required.');
  }

  const exclusions = {};
  const exclude = (reason) => { exclusions[reason] = (exclusions[reason] || 0) + 1; };
  const loanIds = new Set();
  const duplicateLoanIds = new Set();
  for (const loan of loans) {
    if (!loan || typeof loan.id !== 'string') continue;
    if (loanIds.has(loan.id)) duplicateLoanIds.add(loan.id);
    loanIds.add(loan.id);
  }
  const paymentsByLoan = new Map();
  for (const payment of payments) {
    if (!payment || typeof payment.loan_id !== 'string') {
      exclude('invalid_payment_record');
      continue;
    }
    const amount = Number(payment.amount);
    const paidAt = Date.parse(payment.paid_at);
    const list = paymentsByLoan.get(payment.loan_id) ?? [];
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(paidAt) || paidAt > asOf) {
      list.push({ invalid: true });
      paymentsByLoan.set(payment.loan_id, list);
      continue;
    }
    list.push({ amount, paidAt });
    paymentsByLoan.set(payment.loan_id, list);
  }

  const examples = [];
  for (const loan of loans) {
    if (!loan || typeof loan.id !== 'string') {
      exclude('invalid_loan_record');
      continue;
    }
    if (duplicateLoanIds.has(loan.id)) {
      exclude('duplicate_loan_id');
      continue;
    }
    if (loan.status === 'void') {
      exclude('void_loan');
      continue;
    }
    if (loan.status !== 'active') {
      exclude('unsupported_loan_status');
      continue;
    }
    const dueDeadline = jakartaDueDeadline(loan.due_date);
    const issuedAt = Date.parse(loan.created_at);
    const amount = Number(loan.amount);
    if (!Number.isFinite(dueDeadline) || !Number.isFinite(issuedAt)
      || issuedAt > asOf || !Number.isSafeInteger(amount) || amount <= 0) {
      exclude('invalid_loan_fields');
      continue;
    }
    const loanPayments = paymentsByLoan.get(loan.id) ?? [];
    if (loanPayments.some((payment) => payment.invalid)) {
      exclude('invalid_payment_record');
      continue;
    }
    const orderedPayments = [...loanPayments].sort((left, right) => left.paidAt - right.paidAt);
    let totalPaid = 0;
    let settledAtFromPayments = null;
    for (const payment of orderedPayments) {
      totalPaid += payment.amount;
      if (totalPaid === amount) settledAtFromPayments = payment.paidAt;
    }
    const recordedPaid = loan.paid_amount == null ? 0 : Number(loan.paid_amount);
    if (!Number.isSafeInteger(recordedPaid) || recordedPaid < 0
      || recordedPaid > amount || totalPaid !== recordedPaid || totalPaid > amount
      || (loan.settled_at != null
        && (totalPaid !== amount || !Number.isFinite(Date.parse(loan.settled_at))
          || Date.parse(loan.settled_at) !== settledAtFromPayments
          || Date.parse(loan.settled_at) > asOf))
      || (totalPaid === amount && loan.settled_at == null)) {
      exclude('inconsistent_payment_ledger');
      continue;
    }
    if (dueDeadline >= asOf) {
      exclude('not_matured');
      continue;
    }

    const paidByDueDate = loanPayments
      .filter((payment) => payment.paidAt <= dueDeadline)
      .reduce((sum, payment) => sum + payment.amount, 0);
    const label = paidByDueDate >= amount ? 1 : 0;

    try {
      const features = smartKasbonFeatureVector({
        amount,
        due_date: loan.due_date,
        created_at: loan.created_at,
        decision_features: loan.decision_features,
      });
      if (typeof loan.customer_id !== 'string' || !loan.customer_id) {
        exclude('missing_customer_group');
        continue;
      }
      examples.push({
        customerGroup: loan.customer_id,
        issuedAt,
        features,
        label,
      });
    } catch {
      exclude('invalid_or_incomplete_feature_snapshot');
    }
  }
  return {
    examples: examples.sort((left, right) => left.issuedAt - right.issuedAt),
    exclusions,
  };
}

export function buildSmartKasbonTrainingExamples(loans, payments, asOf = Date.now()) {
  return buildSmartKasbonTrainingDataset(loans, payments, asOf).examples;
}

export function splitSmartKasbonExamples(examples, trainingFraction = 0.8) {
  if (!Array.isArray(examples) || !Number.isFinite(trainingFraction)
    || trainingFraction <= 0 || trainingFraction >= 1) {
    throw new TypeError('A dataset and a training fraction between 0 and 1 are required.');
  }
  const ordered = [...examples].sort((left, right) => left.issuedAt - right.issuedAt);
  if (ordered.length < 2) return { training: [], evaluation: [], cutoffAt: null };
  const cutoffAt = ordered[Math.floor(ordered.length * trainingFraction)]?.issuedAt;
  if (!Number.isFinite(cutoffAt)) return { training: [], evaluation: [], cutoffAt: null };

  const training = ordered.filter((row) => row.issuedAt < cutoffAt);
  const trainingCustomers = new Set(training.map((row) => row.customerGroup));
  const evaluation = ordered.filter((row) => row.issuedAt >= cutoffAt
    && !trainingCustomers.has(row.customerGroup));
  return { training, evaluation, cutoffAt };
}

function sigmoid(value) {
  const bounded = clamp(value, -35, 35);
  return 1 / (1 + Math.exp(-bounded));
}

function standardize(training) {
  const featureCount = SMART_KASBON_FEATURE_NAMES.length;
  const means = Array.from({ length: featureCount }, (_, index) =>
    training.reduce((sum, row) => sum + row.features[index], 0) / training.length);
  const scales = Array.from({ length: featureCount }, (_, index) => {
    const variance = training.reduce((sum, row) => sum + (row.features[index] - means[index]) ** 2, 0) / training.length;
    const deviation = Math.sqrt(variance);
    return deviation > 1e-12 ? deviation : 1;
  });
  return { means, scales };
}

function fitLogisticRegression(training, trainedAt) {
  const { means, scales } = standardize(training);
  const featureCount = SMART_KASBON_FEATURE_NAMES.length;
  const weights = Array(featureCount).fill(0);
  let intercept = 0;
  const scaledTraining = training.map((row) =>
    row.features.map((value, index) => (value - means[index]) / scales[index]));
  const epochs = 600;
  const learningRate = 0.06;
  const l2 = 0.01;

  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const gradients = Array(featureCount).fill(0);
    let interceptGradient = 0;
    for (let rowIndex = 0; rowIndex < training.length; rowIndex += 1) {
      const row = training[rowIndex];
      const scaled = scaledTraining[rowIndex];
      const probability = sigmoid(intercept + scaled.reduce((sum, value, index) => sum + value * weights[index], 0));
      const error = probability - row.label;
      interceptGradient += error;
      for (let index = 0; index < featureCount; index += 1) {
        gradients[index] += error * scaled[index];
      }
    }
    intercept -= learningRate * interceptGradient / training.length;
    for (let index = 0; index < featureCount; index += 1) {
      weights[index] -= learningRate * (gradients[index] / training.length + l2 * weights[index]);
    }
  }

  return {
    algorithm: SMART_KASBON_MODEL_ALGORITHM,
    feature_version: SMART_KASBON_FEATURE_VERSION,
    feature_names: [...SMART_KASBON_FEATURE_NAMES],
    trained_at: new Date(trainedAt).toISOString(),
    means,
    scales,
    coefficients: weights,
    intercept,
    threshold: 0.5,
    version: `sklr-v1-${new Date(trainedAt).toISOString()}`,
  };
}

export function predictSmartKasbonModel(artifact, features) {
  validateSmartKasbonModelArtifact(artifact);
  if (!Array.isArray(features) || features.length !== SMART_KASBON_FEATURE_NAMES.length) {
    throw new TypeError('Feature vector does not match the model schema.');
  }
  const scaled = features.map((value, index) => {
    const number = finiteNumber(value, SMART_KASBON_FEATURE_NAMES[index]);
    return (number - artifact.means[index]) / artifact.scales[index];
  });
  const probability = sigmoid(artifact.intercept
    + scaled.reduce((sum, value, index) => sum + value * artifact.coefficients[index], 0));
  if (!Number.isFinite(probability) || probability < 0 || probability > 1) {
    throw new TypeError('Model inference produced an invalid score.');
  }
  return {
    prediction: probability >= artifact.threshold ? 'on_time' : 'at_risk',
    probability,
    model_version: artifact.version,
  };
}

export function validateSmartKasbonModelArtifact(artifact) {
  if (!artifact || typeof artifact !== 'object'
    || artifact.algorithm !== SMART_KASBON_MODEL_ALGORITHM
    || artifact.feature_version !== SMART_KASBON_FEATURE_VERSION
    || !Array.isArray(artifact.feature_names)
    || artifact.feature_names.length !== SMART_KASBON_FEATURE_NAMES.length
    || artifact.feature_names.some((name, index) => name !== SMART_KASBON_FEATURE_NAMES[index])) {
    throw new TypeError('Model artifact schema is invalid.');
  }
  const featureCount = SMART_KASBON_FEATURE_NAMES.length;
  for (const key of ['means', 'scales', 'coefficients']) {
    const values = artifact[key];
    if (!Array.isArray(values) || values.length !== featureCount
      || values.some((value) => !Number.isFinite(value))) {
      throw new TypeError(`Model artifact ${key} are invalid.`);
    }
  }
  if (artifact.scales.some((value) => value <= 0)
    || !Number.isFinite(artifact.intercept)
    || artifact.threshold !== 0.5
    || typeof artifact.version !== 'string'
    || artifact.version !== `sklr-v1-${artifact.trained_at}`
    || !Number.isFinite(Date.parse(artifact.trained_at))
    || new Date(Date.parse(artifact.trained_at)).toISOString() !== artifact.trained_at) {
    throw new TypeError('Model artifact parameters are invalid.');
  }
}

/** @param {Readonly<SmartKasbonModelMinimums>} [minimums] */
export function isSmartKasbonModelEvaluationEligible(metrics, minimums = SMART_KASBON_MODEL_MINIMUMS) {
  const evaluation = metrics?.evaluation;
  const baseline = metrics?.baseline;
  const savedMinimums = metrics?.minimums;
  if (!metrics || metrics.activation_eligible !== true
    || metrics.algorithm !== SMART_KASBON_MODEL_ALGORITHM
    || metrics.feature_version !== SMART_KASBON_FEATURE_VERSION
    || metrics.split !== 'chronological_holdout_with_customer_group_exclusion'
    || metrics.target !== 'paid_in_full_by_due_date'
    || !evaluation || !baseline
    || !savedMinimums
    || !Number.isSafeInteger(evaluation.sample_count)
    || !Number.isSafeInteger(metrics.training_count)
    || !Number.isSafeInteger(metrics.evaluation_count)
    || !Number.isSafeInteger(metrics.evaluation_customers)
    || !Number.isSafeInteger(metrics.training_class_counts?.positive)
    || !Number.isSafeInteger(metrics.training_class_counts?.negative)
    || !evaluation.class_counts
    || !Number.isSafeInteger(evaluation.class_counts.positive)
    || !Number.isSafeInteger(evaluation.class_counts.negative)) return false;
  const required = {};
  for (const key of Object.keys(SMART_KASBON_MODEL_MINIMUMS)) {
    if (!Number.isSafeInteger(savedMinimums[key])
      || savedMinimums[key] < SMART_KASBON_MODEL_MINIMUMS[key]) return false;
    required[key] = Math.max(savedMinimums[key], minimums[key]);
  }
  if (metrics.training_count < required.trainingRows
    || metrics.evaluation_count < required.evaluationRows
    || metrics.training_class_counts.positive < required.trainingPerClass
    || metrics.training_class_counts.negative < required.trainingPerClass
    || evaluation.sample_count < required.evaluationRows
    || evaluation.sample_count !== metrics.evaluation_count
    || evaluation.class_counts.positive < required.evaluationPerClass
    || evaluation.class_counts.negative < required.evaluationPerClass
    || metrics.evaluation_customers < required.evaluationCustomers) return false;
  const metricNames = [
    'accuracy', 'precision', 'recall', 'f1', 'brier_score',
    'expected_calibration_error', 'pr_auc', 'roc_auc',
  ];
  if (metricNames.some((key) => !Number.isFinite(evaluation[key])
    || evaluation[key] < 0 || evaluation[key] > 1)
    || metricNames.some((key) => !Number.isFinite(baseline[key])
      || baseline[key] < 0 || baseline[key] > 1)
    || !evaluation.confusion_matrix
    || Object.values(evaluation.confusion_matrix).some((value) => !Number.isSafeInteger(value) || value < 0)
    || Object.values(evaluation.confusion_matrix).reduce((sum, value) => sum + value, 0) !== evaluation.sample_count
    || baseline.sample_count !== evaluation.sample_count
    || baseline.class_counts?.positive !== evaluation.class_counts.positive
    || baseline.class_counts?.negative !== evaluation.class_counts.negative
    || !baseline.confusion_matrix
    || Object.values(baseline.confusion_matrix).some((value) => !Number.isSafeInteger(value) || value < 0)
    || Object.values(baseline.confusion_matrix).reduce((sum, value) => sum + value, 0) !== baseline.sample_count) {
    return false;
  }
  return evaluation.pr_auc > baseline.pr_auc
    && evaluation.brier_score < baseline.brier_score
    && evaluation.expected_calibration_error <= 0.1;
}

function classCounts(rows) {
  return rows.reduce((counts, row) => {
    counts[row.label === 1 ? 'positive' : 'negative'] += 1;
    return counts;
  }, { positive: 0, negative: 0 });
}

function confusionMetrics(rows, probabilities) {
  let truePositive = 0;
  let falsePositive = 0;
  let trueNegative = 0;
  let falseNegative = 0;
  let brierTotal = 0;
  const bins = Array.from({ length: 10 }, () => ({ count: 0, probability: 0, observed: 0 }));
  rows.forEach((row, index) => {
    const probability = probabilities[index];
    const predicted = probability >= 0.5 ? 1 : 0;
    if (row.label === 1 && predicted === 1) truePositive += 1;
    else if (row.label === 0 && predicted === 1) falsePositive += 1;
    else if (row.label === 0 && predicted === 0) trueNegative += 1;
    else falseNegative += 1;
    brierTotal += (probability - row.label) ** 2;
    const bin = bins[Math.min(9, Math.floor(probability * 10))];
    bin.count += 1;
    bin.probability += probability;
    bin.observed += row.label;
  });
  const precision = truePositive + falsePositive ? truePositive / (truePositive + falsePositive) : 0;
  const recall = truePositive + falseNegative ? truePositive / (truePositive + falseNegative) : 0;
  const positives = rows.filter((row) => row.label === 1).length;
  const negatives = rows.length - positives;
  const rocPairs = positives * negatives;
  const rankedAscending = rows.map((row, index) => ({
    label: row.label,
    probability: probabilities[index],
  })).sort((left, right) => left.probability - right.probability);
  let positiveRankTotal = 0;
  for (let index = 0; index < rankedAscending.length;) {
    let end = index + 1;
    while (end < rankedAscending.length
      && rankedAscending[end].probability === rankedAscending[index].probability) end += 1;
    const averageRank = ((index + 1) + end) / 2;
    for (let tied = index; tied < end; tied += 1) {
      if (rankedAscending[tied].label === 1) positiveRankTotal += averageRank;
    }
    index = end;
  }
  const ranked = rows.map((row, index) => ({ label: row.label, probability: probabilities[index] }))
    .sort((left, right) => right.probability - left.probability);
  let seenPositives = 0;
  let precisionSum = 0;
  for (let index = 0; index < ranked.length; index += 1) {
    if (ranked[index].label === 1) {
      seenPositives += 1;
      precisionSum += seenPositives / (index + 1);
    }
  }
  const expectedCalibrationError = bins.reduce((total, bin) => {
    if (!bin.count) return total;
    return total + (bin.count / rows.length)
      * Math.abs(bin.probability / bin.count - bin.observed / bin.count);
  }, 0);
  return {
    sample_count: rows.length,
    class_counts: { positive: positives, negative: negatives },
    accuracy: (truePositive + trueNegative) / rows.length,
    precision,
    recall,
    f1: precision + recall ? 2 * precision * recall / (precision + recall) : 0,
    confusion_matrix: {
      true_positive: truePositive,
      false_positive: falsePositive,
      true_negative: trueNegative,
      false_negative: falseNegative,
    },
    roc_auc: rocPairs ? (positiveRankTotal - positives * (positives + 1) / 2) / rocPairs : null,
    pr_auc: positives ? precisionSum / positives : null,
    brier_score: brierTotal / rows.length,
    expected_calibration_error: expectedCalibrationError,
  };
}

function ruleBasedProbability(features) {
  const riskScore = features[2];
  const overdueRatio = features[7];
  if (overdueRatio > 0 || riskScore < 50) return 0.25;
  if (riskScore >= 75) return 0.75;
  return 0.5;
}

export function predictSmartKasbonRuleBased(decision) {
  if (!decision || typeof decision !== 'object' || Array.isArray(decision)) {
    throw new TypeError('A server risk decision is required.');
  }
  const riskScore = finiteNumber(decision.risk_score, 'risk_score');
  if (riskScore < 0 || riskScore > 100) throw new TypeError('risk_score is outside its valid range.');
  const overdueRatio = finiteNumber(decision.metrics?.overdue_ratio, 'overdue_ratio');
  if (overdueRatio < 0 || overdueRatio > 1) throw new TypeError('overdue_ratio is outside its valid range.');
  const risk = decision.risk;
  if (!['tinggi', 'sedang', 'rendah'].includes(risk)) throw new TypeError('risk category is invalid.');
  if (risk === 'tinggi' || riskScore < 50 || overdueRatio > 0) {
    return {
      method: 'rule_based',
      state: 'predicted',
      prediction: 'at_risk',
      rule: 'high-risk-or-overdue',
      reason: 'Aturan risiko toko mendeteksi skor di bawah 50 atau saldo pelanggan yang sudah jatuh tempo.',
      advisory_only: true,
    };
  }
  if (risk === 'rendah' && riskScore >= 75) {
    return {
      method: 'rule_based',
      state: 'predicted',
      prediction: 'on_time',
      rule: 'low-risk-and-score-at-least-75',
      reason: 'Aturan risiko toko menunjukkan kategori rendah dan skor minimal 75; ini bukan probabilitas terkalibrasi.',
      advisory_only: true,
    };
  }
  return {
    method: 'rule_based',
    state: 'predicted',
    prediction: 'inconclusive',
    rule: 'insufficient-rule-evidence',
    reason: 'Riwayat atau skor belum memenuhi aturan indikasi risiko rendah maupun tinggi.',
    advisory_only: true,
  };
}

export function predictSmartKasbonHybrid({
  model,
  features,
  decision,
  minimums = SMART_KASBON_MODEL_MINIMUMS,
}) {
  const ruleBased = () => predictSmartKasbonRuleBased(decision);
  if (!model) {
    return {
      ...ruleBased(),
      status: 'RULE_BASED_ACTIVE',
      explanation: 'Machine Learning belum aktif karena data historis belum mencukupi. Sistem menggunakan aturan bisnis sementara.',
    };
  }
  try {
    validateSmartKasbonModelArtifact(model.artifact);
    if (model.artifact.feature_version !== model.feature_version
      || !isSmartKasbonModelEvaluationEligible(model.metrics, minimums)) {
      throw new TypeError('Active model artifact or evaluation eligibility is invalid.');
    }
    const prediction = predictSmartKasbonModel(model.artifact, features);
    return {
      method: 'machine_learning',
      state: 'predicted',
      status: 'ML_ACTIVE',
      prediction: prediction.prediction,
      probability: prediction.probability,
      model_version: prediction.model_version,
      trained_at: model.artifact.trained_at,
      training_count: model.training_count,
      evaluation_count: model.evaluation_count,
      metrics: model.metrics,
      limitations: 'Prediksi advisory dari data historis toko; bukan jaminan pelunasan dan tidak mengubah keputusan aturan server.',
      advisory_only: true,
    };
  } catch {
    return {
      ...ruleBased(),
      status: 'RULE_BASED_FALLBACK',
      explanation: 'Machine Learning tidak dapat digunakan pada permintaan ini. Sistem menggunakan aturan bisnis sementara.',
      advisory_only: true,
    };
  }
}

/** @param {Readonly<SmartKasbonModelMinimums>} [minimums] */
export function assessSmartKasbonDataset(examples, minimums = SMART_KASBON_MODEL_MINIMUMS) {
  if (!Array.isArray(examples)) throw new TypeError('A dataset is required.');
  const validExamples = examples.filter((row) => row
    && typeof row.customerGroup === 'string'
    && Number.isFinite(row.issuedAt)
    && (row.label === 0 || row.label === 1)
    && Array.isArray(row.features)
    && row.features.length === SMART_KASBON_FEATURE_NAMES.length
    && row.features.every(Number.isFinite));
  const split = splitSmartKasbonExamples(validExamples);
  const trainingCounts = classCounts(split.training);
  const evaluationCounts = classCounts(split.evaluation);
  const counts = {
    mature_observations: validExamples.length,
    training_observations: split.training.length,
    evaluation_observations: split.evaluation.length,
    on_time: validExamples.filter((row) => row.label === 1).length,
    late: validExamples.filter((row) => row.label === 0).length,
    training_class_counts: trainingCounts,
    evaluation_class_counts: evaluationCounts,
    training_customers: new Set(split.training.map((row) => row.customerGroup)).size,
    evaluation_customers: new Set(split.evaluation.map((row) => row.customerGroup)).size,
    cutoff_at: split.cutoffAt == null ? null : new Date(split.cutoffAt).toISOString(),
  };
  const eligible = split.training.length >= minimums.trainingRows
    && split.evaluation.length >= minimums.evaluationRows
    && trainingCounts.positive >= minimums.trainingPerClass
    && trainingCounts.negative >= minimums.trainingPerClass
    && evaluationCounts.positive >= minimums.evaluationPerClass
    && evaluationCounts.negative >= minimums.evaluationPerClass
    && counts.evaluation_customers >= minimums.evaluationCustomers;
  return {
    eligible,
    state: eligible ? 'ML_READY_TO_TRAIN' : 'RULE_BASED_ACTIVE',
    counts,
    minimums: { ...minimums },
    reason: eligible
      ? 'Jumlah label matang, distribusi kelas, split kronologis, dan pelanggan evaluasi independen memenuhi batas.'
      : 'Label matang, kedua kelas, ukuran holdout, atau keragaman pelanggan belum memenuhi batas training.',
  };
}

/** @param {Readonly<SmartKasbonModelMinimums>} [options.minimums] */
export function trainAndEvaluateSmartKasbonModel(examples, {
  trainedAt = Date.now(),
  minimums = SMART_KASBON_MODEL_MINIMUMS,
} = {}) {
  if (!Array.isArray(examples) || !Number.isFinite(trainedAt)) {
    throw new TypeError('Examples and a valid training timestamp are required.');
  }
  const validExamples = examples.filter((row) => row
    && typeof row.customerGroup === 'string'
    && Number.isFinite(row.issuedAt)
    && (row.label === 0 || row.label === 1)
    && Array.isArray(row.features)
    && row.features.length === SMART_KASBON_FEATURE_NAMES.length
    && row.features.every(Number.isFinite));
  const split = splitSmartKasbonExamples(validExamples);
  const trainingCounts = classCounts(split.training);
  const evaluationCounts = classCounts(split.evaluation);
  const evaluationCustomers = new Set(split.evaluation.map((row) => row.customerGroup)).size;
  const counts = {
    eligible_count: validExamples.length,
    training_count: split.training.length,
    evaluation_count: split.evaluation.length,
    training_customers: new Set(split.training.map((row) => row.customerGroup)).size,
    evaluation_customers: evaluationCustomers,
    training_class_counts: trainingCounts,
    evaluation_class_counts: evaluationCounts,
    cutoff_at: split.cutoffAt == null ? null : new Date(split.cutoffAt).toISOString(),
  };

  const meetsMinimums = split.training.length >= minimums.trainingRows
    && split.evaluation.length >= minimums.evaluationRows
    && trainingCounts.positive >= minimums.trainingPerClass
    && trainingCounts.negative >= minimums.trainingPerClass
    && evaluationCounts.positive >= minimums.evaluationPerClass
    && evaluationCounts.negative >= minimums.evaluationPerClass
    && evaluationCustomers >= minimums.evaluationCustomers;
  if (!meetsMinimums) {
    return {
      state: 'insufficient_data',
      reason: 'Belum ada cukup label matang dengan fitur historis untuk split waktu dan pelanggan independen.',
      minimums: { ...minimums },
      counts,
    };
  }

  const artifact = fitLogisticRegression(split.training, trainedAt);
  const predictions = split.evaluation.map((row) => predictSmartKasbonModel(artifact, row.features).probability);
  const modelMetrics = confusionMetrics(split.evaluation, predictions);
  const baselineMetrics = confusionMetrics(
    split.evaluation,
    split.evaluation.map((row) => ruleBasedProbability(row.features)),
  );
  const metrics = {
    algorithm: SMART_KASBON_MODEL_ALGORITHM,
    feature_version: SMART_KASBON_FEATURE_VERSION,
    target: 'paid_in_full_by_due_date',
    split: 'chronological_holdout_with_customer_group_exclusion',
    evaluation: modelMetrics,
    baseline: baselineMetrics,
    minimums: { ...minimums },
    activation_eligible: false,
    ...counts,
  };
  metrics.activation_eligible = true;
  const activationEligible = isSmartKasbonModelEvaluationEligible(metrics, minimums);
  metrics.activation_eligible = activationEligible;
  return {
    state: 'candidate',
    reason: activationEligible
      ? 'Model melewati guard evaluasi teknis; perlu aktivasi owner untuk digunakan sebagai prediksi advisory.'
      : 'Model tidak mengungguli baseline secara memadai dan tidak dapat diaktifkan.',
    model: artifact,
    metrics,
    counts,
  };
}
