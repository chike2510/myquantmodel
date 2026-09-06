export const WEIGHTS = { trend: 0.15, structure: 0.15, momentum: 0.10, volatility: 0.10, crossMarket: 0.15, macro: 0.10, entryQuality: 0.10, riskReward: 0.10, liquiditySession: 0.05 };
export const FILTER_THRESHOLDS = { minSetupScore: 75, minProbability: 0.60, minRR: 1.5 };
export const RISK_TIERS = { standard: 0.005, strong: 0.0075, exceptional: 0.01 };
export const DAILY_LOSS_STOP = -0.02;

export function computeSetupScore(subscores) {
  return Math.round(Object.keys(WEIGHTS).reduce((total, key) => {
    const score = subscores[key];
    if (typeof score !== 'number' || score < 0 || score > 100) throw new Error(`Invalid subscore for ${key}`);
    return total + score * WEIGHTS[key];
  }, 0));
}
export function scoreBreakdown(subscores) {
  return Object.entries(WEIGHTS).map(([key, weight]) => ({ key, weight, score: subscores[key], contribution: Math.round(subscores[key] * weight * 10) / 10 }));
}
export function riskTierFor(score) {
  if (score >= 93) return { tier: 'exceptional', risk: RISK_TIERS.exceptional };
  if (score >= 85) return { tier: 'strong', risk: RISK_TIERS.strong };
  if (score >= 75) return { tier: 'standard', risk: RISK_TIERS.standard };
  return { tier: 'none', risk: 0 };
}

export function applyTradeFilter({ setupScore, probability, riskReward, dataQuality, verified, regimeSupportsSetup, contradictionReasons = [], dailyPnLPct, planComplete }) {
  if (dailyPnLPct <= DAILY_LOSS_STOP) return { decision: 'STOP_TRADING_TODAY', reasons: [`Daily P&L ${(dailyPnLPct * 100).toFixed(2)}% breached the -2% internal stop`] };
  const reasons = [];
  if (setupScore < FILTER_THRESHOLDS.minSetupScore) reasons.push(`Setup score ${setupScore} < 75`);
  if (probability < FILTER_THRESHOLDS.minProbability) reasons.push(`Probability ${(probability * 100).toFixed(1)}% < 60%`);
  if (riskReward < FILTER_THRESHOLDS.minRR) reasons.push(`R:R ${riskReward.toFixed(2)} < 1.5`);
  if (!dataQuality?.current) reasons.push(dataQuality?.reason || 'Market data is stale or incomplete');
  if (!regimeSupportsSetup) reasons.push('Market regime does not support the selected direction');
  if (contradictionReasons.length) reasons.push(...contradictionReasons);
  if (!planComplete) reasons.push('Entry, stop, and target plan is incomplete');
  if (verified?.some(item => item.status !== 'VERIFIED')) return { decision: 'WAIT', reasons: [...reasons, 'Required macro, cross-market, news, or session evidence is not verified'] };
  if (reasons.length) return { decision: 'NO_TRADE', reasons };
  return { decision: 'TRADE', reasons: [] };
}

export function calculatePositionSize({ equity, riskPct, stopDistancePips, pipValuePerLot, maxLots, lotStep = 0.01, minLots = 0.01 }) {
  const riskAmount = Math.max(0, equity * riskPct);
  const rawLots = stopDistancePips > 0 && pipValuePerLot > 0 ? riskAmount / (stopDistancePips * pipValuePerLot) : 0;
  const lots = Math.max(0, Math.floor(rawLots / lotStep) * lotStep);
  const capped = maxLots ? Math.min(lots, maxLots) : lots;
  return { riskAmount: Math.round(riskAmount * 100) / 100, lots: capped >= minLots ? Number(capped.toFixed(2)) : 0, cappedByMaxLots: Boolean(maxLots && lots > maxLots), invalid: !stopDistancePips || !pipValuePerLot };
}
export function calculateTradePlan({ price, direction, atr, rr, stopDistance }) {
  const distance = stopDistance > 0 ? stopDistance : atr * 1.5;
  const stop = direction === 'LONG' ? price - distance : price + distance;
  const target1 = direction === 'LONG' ? price + distance * 1.5 : price - distance * 1.5;
  const target2 = direction === 'LONG' ? price + distance * Math.max(2, rr) : price - distance * Math.max(2, rr);
  const expectedMove = atr * 1.5;
  return { entry: price, entryZone: { low: direction === 'LONG' ? price - atr * 0.15 : price - atr * 0.15, high: direction === 'LONG' ? price + atr * 0.15 : price + atr * 0.15 }, stop, target1, target2, invalidation: stop, expectedMove, stopDistance: distance, rr: Math.max(2, rr) };
}
export function expectancy(probability, rr) { return probability * rr - (1 - probability); }
export function classifyCompetitionState({ growthPct = 0, leaderboardGapPct = null }) {
  if (growthPct <= DAILY_LOSS_STOP * 100) return 'DEFENSIVE';
  if (leaderboardGapPct != null && leaderboardGapPct < 2) return 'AGGRESSIVE';
  return 'NORMAL';
}
