// Optional Finnhub context proxy. The deterministic engine never fabricates context.
const BASE_URL = 'https://finnhub.io/api/v1';
const API_KEY = process.env.FINNHUB_API_KEY;

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });
  if (!API_KEY) return res.status(200).json({ configured: false, events: [], news: [] });
  const action = req.query?.action || 'calendar';
  const today = new Date();
  const from = req.query?.from || today.toISOString().slice(0, 10);
  const to = req.query?.to || new Date(today.getTime() + 86400000).toISOString().slice(0, 10);
  const params = new URLSearchParams({ token: API_KEY });
  let endpoint;
  if (action === 'calendar') {
    endpoint = '/calendar/economic'; params.set('from', from); params.set('to', to);
  } else if (action === 'news') {
    endpoint = '/news'; params.set('category', 'general');
  } else return res.status(400).json({ error: 'Unsupported context action' });
  try {
    const response = await fetch(`${BASE_URL}${endpoint}?${params}`);
    const data = await response.json();
    return res.status(response.status).json({ configured: true, ...(action === 'calendar' ? { events: data.economicCalendar || [] } : { news: Array.isArray(data) ? data.slice(0, 10) : [] }) });
  } catch (error) { return res.status(502).json({ configured: true, error: String(error) }); }
}
