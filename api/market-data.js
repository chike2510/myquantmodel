// Vercel serverless proxy for Twelve Data. Keeps the API key server-side.
const BASE_URL = 'https://api.twelvedata.com';
const API_KEY = process.env.TWELVEDATA_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!API_KEY) return res.status(500).json({ error: 'TWELVEDATA_API_KEY is not configured' });

  const { action, symbol, interval, outputsize = '300' } = req.query || {};
  if (!symbol || !['candles', 'quote'].includes(action)) {
    return res.status(400).json({ error: 'Use action=candles or action=quote and provide symbol' });
  }

  const endpoint = action === 'candles' ? 'time_series' : 'quote';
  const params = new URLSearchParams({ symbol, apikey: API_KEY });
  if (action === 'candles') {
    if (!interval) return res.status(400).json({ error: 'Missing interval for candles request' });
    params.set('interval', interval);
    params.set('outputsize', String(outputsize));
  }

  try {
    const response = await fetch(`${BASE_URL}/${endpoint}?${params}`);
    const data = await response.json();
    return res.status(response.status).json(data);
  } catch (error) {
    return res.status(502).json({ error: 'Twelve Data request failed', detail: String(error) });
  }
}
