export function deriveSmartKasbonAutoPolicy(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
    throw new TypeError('Ringkasan keuangan toko tidak valid.');
  }
  for (const key of ['cash_flow_30', 'net_profit_30']) {
    if (!Number.isSafeInteger(snapshot[key])) {
      throw new TypeError(`Nilai ${key} harus berupa bilangan bulat yang valid.`);
    }
  }

  // Gunakan proksi konservatif dari arus kas bersih dan laba bersih 30 hari.
  const cashAvailable = Math.max(0, snapshot.cash_flow_30);
  const workingCapital = Math.max(0, snapshot.net_profit_30);
  const reserveCash = Math.floor(cashAvailable * 0.5);
  const usableCash = Math.max(0, cashAvailable - reserveCash);
  const capacity = Math.min(usableCash, workingCapital);
  const maxTotalReceivable = Math.max(1, Math.min(5_000_000, Math.floor(capacity * 0.25)));
  const maxPerCustomer = Math.max(1, Math.min(1_000_000, Math.floor(maxTotalReceivable * 0.25)));

  return {
    cash_available: cashAvailable,
    working_capital: workingCapital,
    liabilities: 0,
    reserve_cash: reserveCash,
    max_per_customer: maxPerCustomer,
    max_active_customers: 5,
    max_total_receivable: maxTotalReceivable,
  };
}
