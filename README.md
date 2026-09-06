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
# fill in TWELVEDATA_API_KEY and EXPERIENTIAL_API_KEY; FINNHUB_API_KEY is optional
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
- Server-side Twelve Data proxy with private `TWELVEDATA_API_KEY`
- All indicator math (RSI, EMAs, ATR, ADX, VWAP, swings, prev-day high/low, momentum, volatility percentile)
- Timestamp-aware previous-day levels, session context, liquidity-sweep and breakout/retest observations
- Regime classification (deterministic thresholds)
- Setup scoring + the hard TRADE/WAIT/NO_TRADE/STOP_TRADING_TODAY gate
- Verified evidence states for macro, cross-market, entry quality, and liquidity/session inputs
- Position sizing from stop distance + risk tier
- Entry zone, stop/invalidation, two targets, expected move, and expected R output
- Daily loss stop enforcement (-2%)
- Persistent account and evidence settings in the browser
- Competition mode framing and score-contribution audit
- Chart rendered from the same data feed as the math
- EMA/VWAP/trade-plan overlays on the chart
- Optional Finnhub economic-calendar and general-news context via `FINNHUB_API_KEY`
- Cross-market quote snapshots through the Twelve Data proxy
- Transparent local walk-forward historical check over the fetched candle window
- Rate-limited technical shortlist scanner for three primary instruments

**Still requiring human verification:**
- Macro score, cross-market score, entry quality, and liquidity/session remain explicit evidence inputs.
  The optional calendar, news, and cross-market snapshots inform the review but do not silently mark
  a factor as verified or fabricate a score.
- Estimated probability and target R:R remain user inputs. The local historical check is a transparent
  diagnostic sample, not a calibrated probability model or a guarantee of future performance.

**Known gaps / next steps:**
- NAS100/US30/GER30 symbol mapping in `marketData.js` uses index proxies (NDX/DJI/DAX) — verify
  these match your broker's CFD pricing closely enough before trusting them, or swap in a CFD-specific
  data vendor.
- Finnhub context requires the optional `FINNHUB_API_KEY` environment variable.
- Free Twelve Data tier is 8 req/min — fine for occasional 1H/4H analysis, but smooth 5M polling
  across all 10 symbols requires caching, request budgeting, or a higher plan.

## Compliance note

The rules engine hard-blocks any WAIT/NO_TRADE from being upgraded by the narrative step — the LLM
prompt explicitly forbids changing the decision or the numbers. Nothing here executes trades; it's
display-only, and the UI states that plainly.
