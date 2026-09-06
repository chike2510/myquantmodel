// Factors fully derivable from price/indicator data get a deterministic score.
// Factors that need external context (macro releases, cross-market confirmation,
// live news) are NOT fabricated here — they're passed in from real data you supply
// (calendar API, news check) or left as an explicit manual input in the UI.

export function deriveAutoSubscores(ind, regime, direction) {
  const trend = scoreTrend(ind, regime, direction);
  const structure = scoreStructure(ind, direction);
  const momentum = scoreMomentum(ind, direction);
  const volatility = scoreVolatility(ind);

  return { trend, structure, momentum, volatility };
}

function scoreTrend(ind, regime, direction) {
  if (regime === 'TREND_UP' && direction === 'LONG') return 90;
  if (regime === 'TREND_DOWN' && direction === 'SHORT') return 90;
  if (regime === 'RANGE') return 40;
  if (regime === 'BREAKOUT') return 65;
  if ((regime === 'TREND_UP' && direction === 'SHORT') || (regime === 'TREND_DOWN' && direction === 'LONG')) return 15;
  return 30; // chaotic / volatility regimes without clear directional trend read
}

function scoreStructure(ind, direction) {
  const { price, prevDayHigh, prevDayLow, swingHighs, swingLows } = ind;
  if (direction === 'LONG') {
    const brokeStructure = price > prevDayHigh;
    const nearSwingLow = swingLows.length && Math.abs(price - swingLows[swingLows.length - 1].value) / price < 0.003;
    return brokeStructure ? 80 : nearSwingLow ? 70 : 45;
  } else {
    const brokeStructure = price < prevDayLow;
    const nearSwingHigh = swingHighs.length && Math.abs(price - swingHighs[swingHighs.length - 1].value) / price < 0.003;
    return brokeStructure ? 80 : nearSwingHigh ? 70 : 45;
  }
}

function scoreMomentum(ind, direction) {
  const { rsi14, momentum } = ind;
  if (direction === 'LONG') {
    if (rsi14 > 70) return 55; // overbought caution
    if (rsi14 > 50 && momentum > 0) return 85;
    if (rsi14 < 40) return 20;
    return 50;
  } else {
    if (rsi14 < 30) return 55;
    if (rsi14 < 50 && momentum < 0) return 85;
    if (rsi14 > 60) return 20;
    return 50;
  }
}

function scoreVolatility(ind) {
  // Reward the "sweet spot" — enough volatility for the move to reach target,
  // but not so chaotic that ATR-based stops get blown through immediately.
  const { atrPercentile } = ind;
  if (atrPercentile == null) return 50;
  if (atrPercentile >= 35 && atrPercentile <= 75) return 85;
  if (atrPercentile > 90) return 35; // chaotic expansion
  if (atrPercentile < 15) return 40; // too dead to reach target before session ends
  return 60;
}

export function scoreRiskReward(rr) {
  if (rr >= 3) return 100;
  if (rr >= 2) return 85;
  if (rr >= 1.5) return 70;
  return Math.max(0, Math.round(rr / 1.5 * 70));
}
