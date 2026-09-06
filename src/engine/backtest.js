// Lightweight, deliberately transparent walk-forward estimate.
// This is not a production-grade backtest and must never be presented as a guarantee.
export function backtestTrendSetups(candles, { horizon = 8, atrMultiple = 1.5 } = {}) {
  if (!candles || candles.length < 80) return { available: false, reason: 'Need at least 80 candles', trades: 0 };
  const trades = [];
  for (let i = 50; i < candles.length - horizon; i++) {
    const slice = candles.slice(0, i + 1);
    const closes = slice.map(c => c.close);
    const fast = average(closes.slice(-20));
    const slow = average(closes.slice(-50));
    const direction = fast > slow ? 'LONG' : fast < slow ? 'SHORT' : null;
    if (!direction) continue;
    const entry = closes.at(-1);
    const atr = average(slice.slice(-14).map(c => c.high - c.low));
    const risk = atr * atrMultiple;
    const reward = risk * 1.5;
    const future = candles.slice(i + 1, i + 1 + horizon);
    const hit = future.find(c => direction === 'LONG' ? c.high >= entry + reward || c.low <= entry - risk : c.low <= entry - reward || c.high >= entry + risk);
    if (!hit) continue;
    const win = direction === 'LONG' ? hit.high >= entry + reward : hit.low <= entry - reward;
    trades.push({ direction, win, r: win ? 1.5 : -1 });
  }
  const wins = trades.filter(t => t.win).length;
  return { available: trades.length >= 10, sampleSize: trades.length, wins, losses: trades.length - wins, winRate: trades.length ? wins / trades.length : null, expectancyR: trades.length ? trades.reduce((a, t) => a + t.r, 0) / trades.length : null, method: 'EMA20/EMA50 direction, 1.5 ATR stop, 1.5R target, fixed horizon' };
}
function average(values) { return values.reduce((a, b) => a + b, 0) / Math.max(1, values.length); }
