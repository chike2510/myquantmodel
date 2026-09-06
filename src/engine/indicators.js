// Deterministic indicator and market-context calculations.
// No AI-generated number is used by the decision gate.
import { RSI, EMA, ATR, ADX, VWAP } from 'technicalindicators';

export function computeIndicators(candles) {
  if (!candles || candles.length < 210) return { insufficientData: true, candleCount: candles?.length ?? 0 };

  const close = candles.map(c => c.close);
  const high = candles.map(c => c.high);
  const low = candles.map(c => c.low);
  const volume = candles.map(c => c.volume ?? 0);
  const rsi14 = RSI.calculate({ period: 14, values: close });
  const ema20 = EMA.calculate({ period: 20, values: close });
  const ema50 = EMA.calculate({ period: 50, values: close });
  const ema200 = EMA.calculate({ period: 200, values: close });
  const atr14 = ATR.calculate({ period: 14, high, low, close });
  const adx14 = ADX.calculate({ period: 14, high, low, close });
  const vwap = VWAP.calculate({ high, low, close, volume });
  const last = arr => arr[arr.length - 1];
  const logReturns = close.slice(1).map((v, i) => Math.log(v / close[i])).filter(Number.isFinite);
  const recentReturns = logReturns.slice(-30);
  const mean = recentReturns.reduce((a, b) => a + b, 0) / Math.max(1, recentReturns.length);
  const variance = recentReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / Math.max(1, recentReturns.length);
  const atrLast = last(atr14);
  const atrPercentile = percentileRank(atr14, atrLast);
  const swingHighs = findSwings(high, 'high');
  const swingLows = findSwings(low, 'low');
  const current = candles[candles.length - 1];
  const priorDay = priorDayLevels(candles, current.time);
  const atrNAgo = atr14[atr14.length - 15] ?? atr14[0];
  const rangeState = atrLast > atrNAgo * 1.15 ? 'EXPANSION' : atrLast < atrNAgo * 0.85 ? 'CONTRACTION' : 'STABLE';
  const momentumRaw = close.at(-1) - close.at(-11);
  const momentum = atrLast ? momentumRaw / atrLast : 0;
  const session = sessionContext(candles);
  const liquiditySweep = detectLiquiditySweep(candles, priorDay, swingHighs, swingLows);
  const breakout = detectBreakoutRetest(candles, priorDay, atrLast);
  const volumeQuality = volume.filter(v => v > 0).length / Math.max(1, volume.length);

  return {
    insufficientData: false, price: last(close), candleCount: candles.length,
    rsi14: last(rsi14), ema20: last(ema20), ema50: last(ema50), ema200: last(ema200),
    atr14: atrLast, atrPercentile, adx14: last(adx14)?.adx, diPlus: last(adx14)?.pdi,
    diMinus: last(adx14)?.mdi, vwap: last(vwap), realizedVol: Math.sqrt(variance),
    returnSample: recentReturns.length, rangeState, momentum, momentumRaw,
    swingHighs: swingHighs.slice(-5), swingLows: swingLows.slice(-5),
    prevDayHigh: priorDay.high, prevDayLow: priorDay.low, priorDayDate: priorDay.date,
    session, liquiditySweep, breakout, volumeQuality,
  };
}

export function classifyRegime(ind) {
  if (ind.insufficientData) return 'CHAOTIC';
  const { price, ema20, ema50, ema200, adx14, atrPercentile, rangeState } = ind;
  const trendUp = price > ema20 && ema20 > ema50 && ema50 > ema200 && adx14 > 25;
  const trendDown = price < ema20 && ema20 < ema50 && ema50 < ema200 && adx14 > 25;
  if (rangeState === 'EXPANSION' && atrPercentile > 70) return 'VOLATILITY_EXPANSION';
  if (rangeState === 'CONTRACTION' && atrPercentile < 30) return 'VOLATILITY_CONTRACTION';
  if (ind.breakout?.confirmed) return 'BREAKOUT';
  if (trendUp) return 'TREND_UP';
  if (trendDown) return 'TREND_DOWN';
  if (adx14 < 20) return 'RANGE';
  return 'CHAOTIC';
}

function priorDayLevels(candles, currentTime) {
  const currentDate = dateKey(currentTime);
  const prior = candles.filter(c => dateKey(c.time) < currentDate);
  const date = prior.length ? dateKey(prior.at(-1).time) : null;
  const rows = prior.filter(c => dateKey(c.time) === date);
  return { date, high: rows.length ? Math.max(...rows.map(c => c.high)) : null, low: rows.length ? Math.min(...rows.map(c => c.low)) : null };
}
function dateKey(time) { return new Date(time).toISOString().slice(0, 10); }
function percentileRank(arr, value) {
  const sorted = [...arr].filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length || !Number.isFinite(value)) return null;
  return Math.round((sorted.filter(v => v <= value).length / sorted.length) * 100);
}
function findSwings(series, kind) {
  const swings = [];
  for (let i = 2; i < series.length - 2; i++) {
    const window = series.slice(i - 2, i + 3);
    const center = series[i];
    if (kind === 'high' && center === Math.max(...window)) swings.push({ index: i, value: center, confirmed: true });
    if (kind === 'low' && center === Math.min(...window)) swings.push({ index: i, value: center, confirmed: true });
  }
  return swings;
}
function sessionContext(candles) {
  const recent = candles.slice(-96);
  const hour = Number(new Date(recent.at(-1).time).toISOString().slice(11, 13));
  const name = hour >= 0 && hour < 8 ? 'ASIA' : hour < 13 ? 'LONDON' : hour < 21 ? 'NEW_YORK' : 'ROLLOVER';
  const same = recent.filter(c => {
    const h = Number(new Date(c.time).toISOString().slice(11, 13));
    return name === 'ASIA' ? h < 8 : name === 'LONDON' ? h >= 8 && h < 13 : name === 'NEW_YORK' ? h >= 13 && h < 21 : h >= 21;
  });
  return { name, high: same.length ? Math.max(...same.map(c => c.high)) : null, low: same.length ? Math.min(...same.map(c => c.low)) : null, candleCount: same.length, status: same.length >= 2 ? 'OBSERVED' : 'INSUFFICIENT' };
}
function detectLiquiditySweep(candles, prior, highs, lows) {
  const last = candles.at(-1); const previous = candles.at(-2);
  const above = [prior.high, highs.at(-1)?.value].filter(Number.isFinite).some(level => previous.high > level && last.close < level);
  const below = [prior.low, lows.at(-1)?.value].filter(Number.isFinite).some(level => previous.low < level && last.close > level);
  return { detected: above || below, direction: above ? 'HIGH_SWEEP' : below ? 'LOW_SWEEP' : null };
}
function detectBreakoutRetest(candles, prior, atr) {
  const last = candles.at(-1); const previous = candles.at(-2);
  if (!Number.isFinite(prior.high) || !Number.isFinite(prior.low)) return { confirmed: false, retest: false };
  const up = previous.close > prior.high && last.close > prior.high;
  const down = previous.close < prior.low && last.close < prior.low;
  const retest = (up && last.low <= prior.high + atr * 0.25) || (down && last.high >= prior.low - atr * 0.25);
  return { confirmed: up || down, direction: up ? 'LONG' : down ? 'SHORT' : null, retest };
}
