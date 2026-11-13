export const SMART_KASBON_MODEL_ALGORITHM = 'logistic_regression';
export const SMART_KASBON_FEATURE_VERSION = 'smart-kasbon-v1';
export const SMART_KASBON_MODEL_MINIMUMS = Object.freeze({
  trainingRows: 100,
  evaluationRows: 40,
  trainingPerClass: 25,
  evaluationPerClass: 10,
  evaluationCustomers: 10,
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
  const deadline = Date.parse(`${dueDate}T23:59:59.999+07:00`);
  if (!Number.isFinite(deadline)) return NaN;
  if (new Date(deadline).toISOString().slice(0, 10) === dueDate) return deadline;
  return Date.parse(`${dueDate}T23:59:59.999Z`);
}

export function buildSmartKasbonTrainingExamples(loans, payments, asOf = Date.now()) {
  if (!Array.isArray(loans) || !Array.isArray(payments) || !Number.isFinite(asOf)) {
    throw new TypeError('Loans, payments, and a valid as-of time are required.');
  }

  const paymentsByLoan = new Map();
  for (const payment of payments) {
    if (!payment || typeof payment.loan_id !== 'string') continue;
    const amount = Number(payment.amount);
    const paidAt = Date.parse(payment.paid_at);
    if (!Number.isSafeInteger(amount) || amount <= 0 || !Number.isFinite(paidAt)) continue;
    const list = paymentsByLoan.get(payment.loan_id) ?? [];
    list.push({ amount, paidAt });
    paymentsByLoan.set(payment.loan_id, list);
  }

  const examples = [];
  for (const loan of loans) {
    if (!loan || loan.status !== 'active' || typeof loan.id !== 'string') continue;
    const dueDeadline = jakartaDueDeadline(loan.due_date);
    const issuedAt = Date.parse(loan.created_at);
    const amount = Number(loan.amount);
    if (!Number.isFinite(dueDeadline) || !Number.isFinite(issuedAt)
      || !Number.isSafeInteger(amount) || amount <= 0) continue;

    const paidByDueDate = (paymentsByLoan.get(loan.id) ?? [])
      .filter((payment) => payment.paidAt <= dueDeadline && payment.paidAt <= asOf)
      .reduce((sum, payment) => sum + payment.amount, 0);
    let label;
    if (paidByDueDate >= amount) label = 1;
    else if (dueDeadline < asOf) label = 0;
    else continue;

    try {
      const features = smartKasbonFeatureVector({
        amount,
        due_date: loan.due_date,
        created_at: loan.created_at,
        decision_features: loan.decision_features,
      });
      if (typeof loan.customer_id !== 'string' || !loan.customer_id) continue;
      examples.push({
        customerGroup: loan.customer_id,
        issuedAt,
        features,
        label,
      });
    } catch {
      continue;
    }
  }
  return examples.sort((left, right) => left.issuedAt - right.issuedAt);
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
    || typeof artifact.version !== 'string' || !artifact.version) {
    throw new TypeError('Model artifact parameters are invalid.');
  }
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
  const positiveRate = trainingCounts.positive / split.training.length;
  const baselineMetrics = confusionMetrics(split.evaluation, split.evaluation.map(() => positiveRate));
  const activationEligible = modelMetrics.pr_auc > baselineMetrics.pr_auc
    && modelMetrics.brier_score < baselineMetrics.brier_score
    && modelMetrics.expected_calibration_error <= 0.1;

  return {
    state: 'candidate',
    reason: activationEligible
      ? 'Model melewati guard evaluasi teknis; perlu aktivasi owner untuk digunakan sebagai prediksi advisory.'
      : 'Model tidak mengungguli baseline secara memadai dan tidak dapat diaktifkan.',
    model: artifact,
    metrics: {
      algorithm: SMART_KASBON_MODEL_ALGORITHM,
      feature_version: SMART_KASBON_FEATURE_VERSION,
      target: 'paid_in_full_by_due_date',
      split: 'chronological_holdout_with_customer_group_exclusion',
      evaluation: modelMetrics,
      baseline: baselineMetrics,
      activation_eligible: activationEligible,
      ...counts,
    },
    counts,
  };
}
