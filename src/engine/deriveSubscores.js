export function deriveAutoSubscores(ind, regime, direction) {
  return {
    trend: scoreTrend(ind, regime, direction),
    structure: scoreStructure(ind, direction),
    momentum: scoreMomentum(ind, direction),
    volatility: scoreVolatility(ind),
  };
}
function scoreTrend(ind, regime, direction) {
  if ((regime === 'TREND_UP' && direction === 'LONG') || (regime === 'TREND_DOWN' && direction === 'SHORT')) return 90;
  if ((regime === 'TREND_UP' && direction === 'SHORT') || (regime === 'TREND_DOWN' && direction === 'LONG')) return 15;
  if (regime === 'BREAKOUT' && ind.breakout?.direction === direction) return ind.breakout.retest ? 90 : 72;
  if (regime === 'RANGE') return 40;
  return 30;
}
function scoreStructure(ind, direction) {
  const { price, prevDayHigh, prevDayLow, swingHighs, swingLows, liquiditySweep, breakout } = ind;
  if (breakout?.direction === direction && breakout.retest) return 90;
  if (liquiditySweep?.detected) return liquiditySweep.direction === (direction === 'LONG' ? 'LOW_SWEEP' : 'HIGH_SWEEP') ? 82 : 25;
  if (direction === 'LONG') {
    if (Number.isFinite(prevDayHigh) && price > prevDayHigh) return 80;
    const low = swingLows.at(-1)?.value;
    return Number.isFinite(low) && Math.abs(price - low) / price < 0.003 ? 70 : 45;
  }
  if (Number.isFinite(prevDayLow) && price < prevDayLow) return 80;
  const high = swingHighs.at(-1)?.value;
  return Number.isFinite(high) && Math.abs(price - high) / price < 0.003 ? 70 : 45;
}
function scoreMomentum(ind, direction) {
  const { rsi14, momentum } = ind;
  if (direction === 'LONG') {
    if (rsi14 > 70) return 55;
    if (rsi14 > 50 && momentum > 0) return 85;
    if (rsi14 < 40) return 20;
  } else {
    if (rsi14 < 30) return 55;
    if (rsi14 < 50 && momentum < 0) return 85;
    if (rsi14 > 60) return 20;
  }
  return 50;
}
function scoreVolatility(ind) {
  if (ind.atrPercentile == null) return 50;
  if (ind.atrPercentile >= 35 && ind.atrPercentile <= 75) return 85;
  if (ind.atrPercentile > 90 || ind.atrPercentile < 15) return 35;
  return 60;
}
export function scoreRiskReward(rr) {
  if (rr >= 3) return 100;
  if (rr >= 2) return 85;
  if (rr >= 1.5) return 70;
  return Math.max(0, Math.round(rr / 1.5 * 70));
}
