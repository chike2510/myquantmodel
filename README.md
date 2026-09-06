# FundedNext Quant — Decision Support

Manual-trading decision-support dashboard for the FundedNext free trading competition.
The LLM never decides whether to trade — a deterministic rules engine does that; the LLM
only writes the narrative explanation of a decision that's already been made in code.

## Architecture

```
src/engine/indicators.js     → RSI, EMA20/50/200, ATR, ADX, VWAP, swings, regime classification
src/engine/deriveSubscores.js → deterministic factor scores (trend/structure/momentum/volatility)
src/engine/setupScore.js     → weighted setup score, TRADE/WAIT/NO_TRADE/STOP gate, position sizing
src/api/marketData.js        → Twelve Data OHLC + quote fetch
src/components/LiveChart.jsx → lightweight-charts, fed from the same candles as the indicator engine
src/components/Dashboard.jsx → orchestration + output rendering
api/narrative.js             → Vercel serverless fn — Experiential Labs writes WHY/MACRO/CROSS-MARKET prose only
```

## Setup

```bash
npm install
cp .env.example .env
# fill in TWELVEDATA_API_KEY and EXPERIENTIAL_API_KEY
npm run dev
```

Deploy to Vercel as-is — `/api/narrative.js` is picked up automatically as a serverless function.
Set the server-only `TWELVEDATA_API_KEY` and `EXPERIENTIAL_API_KEY` in Vercel project settings.
The frontend now calls `/api/market-data`, so the Twelve Data key is never exposed to the browser.
The narrative endpoint uses Experiential Labs' OpenAI-compatible
gateway. Leave `EXPERIENTIAL_MODEL` blank to discover available models automatically, or set it to
a specific model/alias enabled in your workspace.

## What's real vs. what you still need to wire up

**Working now:**
- Live OHLC candles + live quote (Twelve Data free tier)
- All indicator math (RSI, EMAs, ATR, ADX, VWAP, swings, prev-day high/low, momentum, volatility percentile)
- Regime classification (deterministic thresholds)
- Setup scoring + the hard TRADE/WAIT/NO_TRADE/STOP_TRADING_TODAY gate
- Position sizing from stop distance + risk tier
- Daily loss stop enforcement (-2%)
- Chart rendered from the same data feed as the math

**Deliberately manual inputs (not automated, to avoid fabricating data):**
- Macro score, cross-market score, entry quality, liquidity/session — you fill these in from
  an actual economic calendar / news check / correlated-asset glance. No free reliable API
  exists for economic calendar data, so the tool refuses to guess at these rather than invent them.
- Estimated probability and target R:R — you supply these based on your own read of the setup;
  wiring a real probability model (e.g. historical backtest of similar setups) is a good next step.

**Known gaps / next steps:**
- NAS100/US30/GER30 symbol mapping in `marketData.js` uses index proxies (NDX/DJI/DAX) — verify
  these match your broker's CFD pricing closely enough before trusting them, or swap in a CFD-specific
  data vendor.
- No persistence yet — daily P&L and leaderboard state reset on refresh. Add local storage or a
  small backend table if you want that to persist across sessions.
- Economic calendar / news integration: could add Serper.dev (you're already using it in edgex) or
  a paid TradingEconomics/FMP calendar endpoint to replace the manual macro-score input.
- Free Twelve Data tier is 8 req/min — fine for 1H/4H, will need a paid tier or caching layer for
  smooth 5M polling across all 10 symbols.

## Compliance note

The rules engine hard-blocks any WAIT/NO_TRADE from being upgraded by the narrative step — the LLM
prompt explicitly forbids changing the decision or the numbers. Nothing here executes trades; it's
display-only, and the UI states that plainly.
