// Vercel serverless function. Keeps the Experiential Labs API key server-side.
// The LLM here is NOT allowed to change any number or the TRADE/WAIT/NO_TRADE
// decision — those arrive already computed from the deterministic engine.
// It only writes the qualitative sections (WHY, MACRO, CROSS-MARKET, INVALIDATION note).

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const { computed, macroContext, crossMarketContext } = req.body;
  // computed = { regime, setupScore, decision, probability, riskReward, indicators, symbol, timeframe }

  if (!computed || computed.decision == null) {
    return res.status(400).json({ error: 'Missing computed analysis payload' });
  }

  const systemPrompt = `You are a narrative writer for a quant trading dashboard. You will be given
ALREADY-COMPUTED numbers and a final decision (TRADE / WAIT / NO_TRADE / STOP_TRADING_TODAY).
You must NOT invent, adjust, or contradict any number or the decision. Your only job is to explain
WHY in plain, concise, quantitative language, using the figures given. If data is marked stale or
incomplete, say so plainly rather than papering over it. Output strict JSON with keys:
"why", "macro", "crossMarket", "invalidation", "cancelConditions". No markdown, no extra keys.`;

  const userPrompt = `Computed analysis:\n${JSON.stringify(computed, null, 2)}\n\nMacro context:\n${macroContext || 'none supplied'}\n\nCross-market context:\n${crossMarketContext || 'none supplied'}`;

  try {
    const baseUrl = (process.env.EXPERIENTIAL_BASE_URL || 'https://api.experientiallabs.ai/v1').replace(/\/$/, '');
    const apiKey = process.env.EXPERIENTIAL_API_KEY;
    if (!apiKey) throw new Error('EXPERIENTIAL_API_KEY is not configured');

    let model = process.env.EXPERIENTIAL_MODEL;
    if (!model) {
      const modelsResponse = await fetch(`${baseUrl}/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const modelsData = await modelsResponse.json();
      const models = (modelsData.data || []).map(item => item.id).filter(Boolean);
      const preference = [
        'opus', 'sonnet', 'gpt-5', 'gpt-4.1', 'gpt-4o', 'gemini-2.5-pro',
        'gemini-2.0', 'flash', 'qwen', 'llama',
      ];
      model = preference.map(term => models.find(id => id.toLowerCase().includes(term))).find(Boolean) || models[0];
    }
    if (!model) throw new Error('No Experiential Labs models are available for this API key');

    const response = await fetch(`${baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: 800,
        response_format: { type: 'json_object' },
        messages: [
          { role: 'system', content: systemPrompt },
          { role: 'user', content: userPrompt },
        ],
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error?.message || `Experiential Labs request failed (${response.status})`);
    }
    const text = data.choices?.[0]?.message?.content ?? '{}';
    const clean = text.replace(/```json|```/g, '').trim();
    const narrative = JSON.parse(clean);

    return res.status(200).json({ narrative, generatedAt: new Date().toISOString() });
  } catch (err) {
    return res.status(500).json({ error: 'Narrative generation failed', detail: String(err) });
  }
}
