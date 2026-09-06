// Weights exactly as specified. This module is the compliance-critical gate:
// it decides TRADE / WAIT / NO_TRADE. The LLM never overrides this output.

export const WEIGHTS = {
  trend: 0.15,
  structure: 0.15,
  momentum: 0.10,
  volatility: 0.10,
  crossMarket: 0.15,
  macro: 0.10,
  entryQuality: 0.10,
  riskReward: 0.10,
  liquiditySession: 0.05,
};

export const FILTER_THRESHOLDS = {
  minSetupScore: 75,
  minProbability: 0.60,
  minRR: 1.5,
};

export const RISK_TIERS = {
  standard: 0.005,   // setup score 75–84
  strong: 0.0075,    // setup score 85–92
  exceptional: 0.01, // setup score 93+
};

export const DAILY_LOSS_STOP = -0.02; // -2% equity, hard stop for the day

/**
 * subscores: object with each key in WEIGHTS, each scored 0-100 by the caller
 * (deterministic sub-scoring functions per factor — see scoring/*.js — or
 * supplied by the analysis step; this function only does the weighted sum + gate).
 */
export function computeSetupScore(subscores) {
  let total = 0;
  for (const key of Object.keys(WEIGHTS)) {
    const s = subscores[key];
    if (typeof s !== 'number' || s < 0 || s > 100) {
      throw new Error(`Invalid or missing subscore for "${key}"`);
    }
    total += s * WEIGHTS[key];
  }
  return Math.round(total);
}

export function riskTierFor(setupScore) {
  if (setupScore >= 93) return { tier: 'exceptional', risk: RISK_TIERS.exceptional };
  if (setupScore >= 85) return { tier: 'strong', risk: RISK_TIERS.strong };
  if (setupScore >= FILTER_THRESHOLDS.minSetupScore) return { tier: 'standard', risk: RISK_TIERS.standard };
  return { tier: 'none', risk: 0 };
}

/**
 * The hard gate. Returns { decision: 'TRADE'|'WAIT'|'NO_TRADE'|'STOP_TRADING_TODAY', reasons: [] }
 */
export function applyTradeFilter({
  setupScore,
  probability,
  riskReward,
  dataIsCurrent,
  regimeSupportsSetup,
  hasUnresolvedContradiction,
  dailyPnLPct,
}) {
  const reasons = [];

  if (dailyPnLPct <= DAILY_LOSS_STOP) {
    return { decision: 'STOP_TRADING_TODAY', reasons: [`Daily P&L ${(dailyPnLPct * 100).toFixed(2)}% breached -2% stop`] };
  }

  if (setupScore < FILTER_THRESHOLDS.minSetupScore) reasons.push(`Setup score ${setupScore} < 75`);
  if (probability < FILTER_THRESHOLDS.minProbability) reasons.push(`Probability ${(probability * 100).toFixed(1)}% < 60%`);
  if (riskReward < FILTER_THRESHOLDS.minRR) reasons.push(`R:R ${riskReward.toFixed(2)} < 1.5`);
  if (!dataIsCurrent) reasons.push('Data not current/reliable');
  if (!regimeSupportsSetup) reasons.push('Market regime does not support setup');
  if (hasUnresolvedContradiction) reasons.push('Unresolved contradiction present');

  if (reasons.length > 0) {
    return { decision: 'NO_TRADE', reasons };
  }

  return { decision: 'TRADE', reasons: [] };
}

/**
 * Position sizing from stop distance, account equity, risk%, and instrument specs.
 * pipValue: monetary value of 1 pip per 1 standard lot for the instrument (user/broker-supplied).
 */
export function calculatePositionSize({ equity, riskPct, stopDistancePips, pipValuePerLot, maxLots }) {
  const riskAmount = equity * riskPct;
  const rawLots = riskAmount / (stopDistancePips * pipValuePerLot);
  const lots = Math.floor(rawLots * 100) / 100; // round down to 2 decimals, never round up risk
  return {
    riskAmount: Math.round(riskAmount * 100) / 100,
    lots: maxLots ? Math.min(lots, maxLots) : lots,
    cappedByMaxLots: maxLots ? lots > maxLots : false,
  };
}

/**
 * Competition risk-state classification. Never increases risk because of losing —
 * this only affects framing/urgency in the narrative layer, never the risk tiers above.
 */
export function classifyCompetitionState({ growthPct, leaderboardGapPct }) {
  if (growthPct <= DAILY_LOSS_STOP) return 'DEFENSIVE';
  if (leaderboardGapPct != null && leaderboardGapPct < 2) return 'AGGRESSIVE';
  return 'NORMAL';
}
