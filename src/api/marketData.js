// Twelve Data free tier: 800 requests/day, 8 req/min — fine for 1H/4H, tight for 5M polling.
// Get a free key at https://twelvedata.com/pricing (no card required for free tier).
// Symbol mapping: Twelve Data uses e.g. "XAU/USD", "EUR/USD"; index CFDs vary by broker feed
// availability on free tier — NAS100/US30/GER30 may need a different provider (see README).

const BASE_URL = '/api/market-data';

const INTERVAL_MAP = {
  '4H': '4h',
  '1H': '1h',
  '15M': '15min',
  '5M': '5min',
};

export async function fetchCandles(symbol, timeframe, outputsize = 300) {
  const interval = INTERVAL_MAP[timeframe];
  if (!interval) throw new Error(`Unsupported timeframe: ${timeframe}`);

  const url = `${BASE_URL}?action=candles&symbol=${encodeURIComponent(symbol)}&interval=${interval}&outputsize=${outputsize}`;
  const res = await fetch(url);
  const data = await res.json();

  if (data.status === 'error') {
    throw new Error(`Twelve Data error: ${data.message}`);
  }
  if (!data.values) {
    throw new Error('No candle data returned — check symbol/timeframe/plan limits.');
  }

  // Twelve Data returns newest-first; normalize to oldest-first for indicator math.
  const candles = data.values
    .map(v => ({
      time: v.datetime,
      open: parseFloat(v.open),
      high: parseFloat(v.high),
      low: parseFloat(v.low),
      close: parseFloat(v.close),
      volume: v.volume ? parseFloat(v.volume) : 0,
    }))
    .reverse();

  return {
    candles,
    fetchedAt: new Date().toISOString(),
    source: 'Twelve Data',
    meta: data.meta,
  };
}

export async function fetchQuote(symbol) {
  const url = `${BASE_URL}?action=quote&symbol=${encodeURIComponent(symbol)}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status === 'error') throw new Error(`Twelve Data error: ${data.message}`);
  return {
    price: parseFloat(data.close),
    timestamp: data.timestamp ? new Date(data.timestamp * 1000).toISOString() : new Date().toISOString(),
    source: 'Twelve Data',
  };
}

// Symbol registry matching the competition's primary/secondary market list.
// NAS100/US30/GER30 CFD tickers vary a lot by data vendor — verify these against
// your Twelve Data plan before relying on them; some index CFDs are premium-tier only.
export const SYMBOLS = {
  XAUUSD: 'XAU/USD',
  EURUSD: 'EUR/USD',
  GBPUSD: 'GBP/USD',
  USDJPY: 'USD/JPY',
  AUDUSD: 'AUD/USD',
  USDCAD: 'USD/CAD',
  XAGUSD: 'XAG/USD',
  NAS100: 'NDX', // may require premium plan / different vendor for CFD-matched pricing
  US30: 'DJI',   // same caveat
  GER30: 'DAX',  // same caveat
};
