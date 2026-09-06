// All indicator math lives here as plain deterministic code.
// The LLM never computes numbers — it only narrates what these functions return.

import { RSI, EMA, ATR, ADX, VWAP } from 'technicalindicators';

/**
 * candles: array of { time, open, high, low, close, volume }, oldest first
 */
export function computeIndicators(candles) {
  if (!candles || candles.length < 210) {
    return { insufficientData: true, candleCount: candles?.length ?? 0 };
  }

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

  // Log returns + realized volatility (stdev of log returns, annualized-ish for the sample window)
  const logReturns = [];
  for (let i = 1; i < close.length; i++) {
    logReturns.push(Math.log(close[i] / close[i - 1]));
  }
  const recentReturns = logReturns.slice(-30);
  const mean = recentReturns.reduce((a, b) => a + b, 0) / recentReturns.length;
  const variance = recentReturns.reduce((a, b) => a + (b - mean) ** 2, 0) / recentReturns.length;
  const realizedVol = Math.sqrt(variance);

  // ATR percentile over the trailing window we have (volatility regime context)
  const atrPercentile = percentileRank(atr14, last(atr14));

  // Swing highs/lows (simple fractal: 2 bars either side)
  const swingHighs = findSwings(high, 'high');
  const swingLows = findSwings(low, 'low');

  const prevDayHigh = Math.max(...high.slice(-96, -1)); // rough: last ~day of bars, excludes current
  const prevDayLow = Math.min(...low.slice(-96, -1));

  // Range expansion/contraction: compare last ATR to ATR N bars ago
  const atrNAgo = atr14[atr14.length - 15] ?? atr14[0];
  const rangeState = last(atr14) > atrNAgo * 1.15
    ? 'EXPANSION'
    : last(atr14) < atrNAgo * 0.85
      ? 'CONTRACTION'
      : 'STABLE';

  return {
    insufficientData: false,
    price: last(close),
    rsi14: last(rsi14),
    ema20: last(ema20),
    ema50: last(ema50),
    ema200: last(ema200),
    atr14: last(atr14),
    atrPercentile,
    adx14: last(adx14)?.adx,
    diPlus: last(adx14)?.pdi,
    diMinus: last(adx14)?.mdi,
    vwap: last(vwap),
    realizedVol,
    rangeState,
    swingHighs: swingHighs.slice(-3),
    swingLows: swingLows.slice(-3),
    prevDayHigh,
    prevDayLow,
    momentum: close[close.length - 1] - close[close.length - 11], // 10-bar momentum
  };
}

function percentileRank(arr, value) {
  const sorted = [...arr].filter(v => v != null).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const idx = sorted.findIndex(v => v >= value);
  return Math.round(((idx === -1 ? sorted.length : idx) / sorted.length) * 100);
}

function findSwings(series, kind) {
  const swings = [];
  for (let i = 2; i < series.length - 2; i++) {
    const window = series.slice(i - 2, i + 3);
    const center = series[i];
    if (kind === 'high' && center === Math.max(...window)) swings.push({ index: i, value: center });
    if (kind === 'low' && center === Math.min(...window)) swings.push({ index: i, value: center });
  }
  return swings;
}

/**
 * Regime classification — deterministic thresholds, not LLM judgment.
 */
export function classifyRegime(ind) {
  if (ind.insufficientData) return 'CHAOTIC';

  const { price, ema20, ema50, ema200, adx14, atrPercentile, rangeState } = ind;

  if (rangeState === 'EXPANSION' && atrPercentile > 70) return 'VOLATILITY_EXPANSION';
  if (rangeState === 'CONTRACTION' && atrPercentile < 30) return 'VOLATILITY_CONTRACTION';

  const trendAligned = price > ema20 && ema20 > ema50 && ema50 > ema200;
  const trendAlignedDown = price < ema20 && ema20 < ema50 && ema50 < ema200;

  if (adx14 > 25 && trendAligned) return 'TREND_UP';
  if (adx14 > 25 && trendAlignedDown) return 'TREND_DOWN';
  if (adx14 < 20) return 'RANGE';

  // Breakout: price pierces recent swing extreme with expanding range
  if (rangeState === 'EXPANSION' && (price > ind.prevDayHigh || price < ind.prevDayLow)) {
    return 'BREAKOUT';
  }

  return 'CHAOTIC';
}
