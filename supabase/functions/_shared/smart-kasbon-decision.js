export async function persistSmartKasbonPrediction(admin, storeId, loanId, decision, prediction) {
  if (Object.prototype.hasOwnProperty.call(decision, 'model_prediction')) {
    return { decision, prediction: decision.model_prediction, persisted: false };
  }

  const updatedDecision = { ...decision, model_prediction: prediction };
  const { data, error } = await admin.from('smart_kasbon_decisions')
    .update({ decision: updatedDecision })
    .eq('store_id', storeId)
    .eq('loan_id', loanId)
    .eq('action', 'issue')
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Smart Kasbon decision row was not found for prediction persistence.');
  return { decision: updatedDecision, prediction, persisted: true };
}
