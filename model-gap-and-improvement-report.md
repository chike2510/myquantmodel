# FundedNext Quant Model: Specification Review and Improvement Plan

## Executive conclusion

The current application contains a solid deterministic foundation, but it does not yet implement the complete model described in the specification. The price-data pipeline, indicator calculations, regime classification, weighted setup score, trade gate, risk tiers, daily loss stop, position sizing, chart, and optional narrative layer are present. However, several safety-critical inputs are currently entered manually or hard-coded as valid. As a result, the app can produce a high setup score and a `TRADE` decision without actually verifying macro conditions, cross-market confirmation, data freshness, contradictions, session liquidity, or the user’s probability estimate.

The most important next step is not adding more indicators. It is making the decision gate honest: missing or unverified information should produce `WAIT` or `NO_TRADE`, not count as a neutral score that can still pass the gate.

## Status legend

| Status | Meaning |
|---|---|
| **Implemented** | Present in the current source and used in the analysis flow. |
| **Partial** | Present, but approximated, manually entered, or not fully connected to the specification. |
| **Missing** | Not implemented in the current app. |
| **Risk** | Implemented in a way that can produce misleading or unsafe output. |

## Specification coverage

| Specification area | Status | Current implementation | Assessment and required improvement |
|---|---|---|---|
| Manual-only trading | **Implemented** | The UI states that the user executes trades manually. No execution connector exists. | Keep this boundary explicit in every decision view. |
| Prohibited strategies and behaviors | **Partial** | The README contains a compliance note, but the UI and engine do not explicitly detect or block all prohibited behaviors. | Add a visible compliance panel and reject requests that imply automation, copy trading, grid trading, HFT, or gambling behavior. |
| Current price data | **Implemented** | Twelve Data quote and time-series requests are routed through Vercel serverless functions. | Display both provider timestamp and application fetch time. Reject stale data using an explicit freshness threshold. |
| Economic calendar | **Missing** | Macro score is a manual 0–100 input. | Add a calendar/news provider or require a structured manual event record with event time, currency, impact, and source. |
| Financial news | **Missing** | No news endpoint or news evidence is collected. | Add a source-backed news feed or retain an explicit `NOT_CHECKED` state. Never treat an unchecked macro/news field as neutral. |
| Cross-asset relationships | **Partial** | Cross-market score is manually entered. | Add a configurable relationship map, such as DXY and US yields for metals and USD pairs, Nasdaq/Dow for risk sentiment, and silver for gold confirmation. Show the instruments and timestamps used. |
| Logarithmic returns | **Implemented** | Calculated over recent closes in `indicators.js`. | Add sample length and annualization convention to the output. Current code calls the value realized volatility but does not annualize it despite the comment. |
| ATR | **Implemented** | ATR(14) is calculated locally. | Add ATR units and use it consistently for stop and expected-move calculations. |
| Realized volatility | **Partial** | Standard deviation of the last 30 log returns is calculated. | Rename or document it precisely, and avoid implying annualized volatility unless it is annualized by timeframe. |
| Volatility percentile | **Implemented** | ATR percentile is computed over available ATR observations. | Show the lookback window and handle small samples explicitly. |
| RSI | **Implemented** | RSI(14). | Add visual interpretation and avoid treating overbought or oversold as a standalone reversal signal. |
| EMA 20/50/200 | **Implemented** | All three EMAs are calculated. | Add chart overlays and show the alignment state. |
| VWAP | **Partial** | VWAP is calculated locally. | Forex and many CFD feeds may have zero or proxy volume. Label this as tick-volume VWAP or disable it when volume quality is insufficient. |
| ADX | **Implemented** | ADX(14), DI+ and DI− are calculated. | Include DI direction in trend confirmation and show the ADX threshold used. |
| Momentum | **Partial** | Ten-bar close difference is used. | Normalize momentum by ATR or price so scores are comparable across symbols. |
| Range expansion/contraction | **Implemented** | Current ATR is compared with ATR 15 observations earlier. | Use timeframe-aware lookbacks and show the comparison values. |
| Market structure | **Partial** | Previous-day levels and simple fractal swings are used. | Add higher-high/lower-low structure, break of structure, and change of character with confirmed closed candles. |
| Swing highs/lows | **Implemented** | Five-bar fractal swings are calculated. | Avoid using unconfirmed swings as actionable levels. Mark confirmation status. |
| Previous-day high/low | **Risk** | The code uses the last 96 bars as a rough proxy. | This is only a day for one specific timeframe. Calculate the prior calendar trading day from candle timestamps instead. |
| Session highs/lows | **Missing** | No London, New York, or Asia session logic exists. | Add exchange/session timezone handling, session range, opening range, and session liquidity state. |
| Liquidity sweeps | **Missing** | No sweep detection exists. | Detect a wick through a prior swing or session level followed by a close back inside, with configurable confirmation. |
| Breakout/retest | **Partial** | Breakout classification checks price against rough previous-day levels during ATR expansion. | Add close-confirmed breakout, retest distance, rejection candle, and failed-breakout states. |
| Regimes: TREND_UP/DOWN | **Implemented** | EMA alignment plus ADX threshold. | Add DI confirmation and avoid letting one regime rule hide another without showing the evidence. |
| Regime: RANGE | **Implemented** | ADX below 20. | Combine with normalized range width and mean-reversion location. |
| Regime: BREAKOUT | **Partial** | ATR expansion and price outside rough previous-day levels. | Use confirmed closes and distinguish breakout from volatility shock. |
| Regime: VOLATILITY_EXPANSION | **Implemented** | ATR state and percentile. | This can override a trend regime because it is evaluated first. Display primary and secondary regimes instead of hiding the overlap. |
| Regime: VOLATILITY_CONTRACTION | **Implemented** | ATR state and percentile. | Same overlap issue as expansion. |
| Regime: CHAOTIC | **Implemented** | Fallback state. | Define explicit causes, such as conflicting trend, low data quality, spread shock, or abnormal candle ranges. |
| Directional probability | **Partial** | User supplies a probability input. | Treat it as a manually asserted estimate and display its source. Do not label it model-derived. |
| Expected move | **Missing** | No expected-move calculation or output exists. | Add ATR- and volatility-based expected move with timeframe and confidence interval. |
| Probability TP before SL | **Missing** | No backtest or calibrated probability model exists. | Do not present a manually entered probability as a computed probability. Add historical simulation only after defining the sampling and calibration method. |
| Expected R multiple | **Partial** | User supplies target R:R. | Add expectancy calculation: `p × reward − (1 − p) × risk`, with clear assumptions. |
| Cross-market confirmation | **Partial** | Manual score, default 50. | Replace default neutrality with `NOT_VERIFIED`; score only when evidence and timestamps are present. |
| Macro confirmation | **Partial** | Manual score, default 50. | Require event source, event time, currency, impact, and interpretation. |
| Entry quality | **Partial** | Manual score. | Add structured choices for location, trigger, spread, slippage, and distance to invalidation. |
| Invalidation level | **Missing** | Narrative may mention invalidation, but no numeric invalidation level is calculated or displayed. | Calculate and display a price level before any trade can pass. |
| Risk/reward | **Partial** | User enters R:R and the score uses it. | Require entry, stop, and target prices; calculate R:R rather than accepting it as an unverified number. |
| Setup-score weights | **Implemented** | The weights match the specification exactly. | Add a score breakdown and validation that all nine factors have current evidence. |
| Setup threshold of 75 | **Implemented** | Hard-coded in `FILTER_THRESHOLDS`. | Add a visible threshold badge and an audit trail. |
| Probability threshold of 60% | **Implemented** | Hard gate uses 0.60. | Validate input range and distinguish user estimate from calibrated model probability. |
| R:R threshold of 1:1.5 | **Implemented** | Hard gate uses 1.5. | Calculate from price levels and show the formula. |
| Current and reliable data gate | **Risk** | `dataIsCurrent: true` is hard-coded. | Compute freshness from provider timestamps, missing candles, gaps, market status, and response errors. |
| Contradiction gate | **Risk** | `hasUnresolvedContradiction: false` is hard-coded. | Derive contradictions from trend versus momentum, macro versus direction, cross-market disagreement, and entry versus regime. |
| `NO_TRADE` when conditions fail | **Implemented** | Failing conditions produce `NO_TRADE`. | Add a distinct `WAIT` state for missing or pending confirmation instead of collapsing every failure into `NO_TRADE`. |
| Standard/strong/exceptional risk | **Implemented** | 0.5%, 0.75%, and 1% tiers are present. | Keep the 1% hard cap and display the reason for each tier. |
| Daily loss stop at -2% | **Implemented** | Hard gate produces `STOP_TRADING_TODAY`. | Persist daily P&L and reset it at the correct trading-day boundary. Current value resets on refresh. |
| Official-loss-limit caution | **Partial** | README warns about the boundary. | Add a hard-coded safety buffer and a visible distance-to-limit warning. |
| Competition mode | **Partial** | `classifyCompetitionState` exists but is not connected to the UI or analysis flow. | Add leaderboard inputs, growth, gaps, days remaining, and DEFENSIVE/NORMAL/AGGRESSIVE state. Keep it framing-only; never let it raise risk above the base tiers. |
| Output timestamp | **Partial** | `fetchedAt` and quote timestamp are shown. | Separate `provider timestamp`, `received at`, and `data age`; display timezone. |
| Account balance | **Implemented** | Equity input is displayed. | Add starting balance, current balance, and growth percentage. |
| Competition status | **Missing** | No days remaining or leaderboard position. | Add optional competition panel. |
| Top setup | **Missing** | User selects one symbol and direction. | Add a scan mode that ranks all supported instruments and returns the best valid setup or `NO_VALID_SETUP`. |
| Entry zone | **Missing** | No entry zone is calculated. | Add trigger, entry range, and maximum chase distance. |
| Stop | **Partial** | Stop distance is manually entered. | Add a numeric stop price derived from structure and ATR. |
| Target 1/Target 2 | **Missing** | Only target R:R is entered. | Calculate two target levels and show which target was used for the gate. |
| Confidence | **Missing** | No confidence field is output. | Add confidence only after defining whether it is calibrated probability, evidence completeness, or a presentation label. |
| Narrative explanation | **Partial** | Optional LLM writes qualitative sections. | Keep it subordinate to deterministic results and include data-source status in its prompt. |
| Manual execution disclaimer | **Implemented** | Visible in output. | Repeat it near the final decision and on mobile. |

## Important correctness and safety issues

### 1. The gate currently treats unverified inputs as valid

The dashboard initializes cross-market, macro, entry-quality, and liquidity/session scores to 50. It also initializes probability to 60%, sets `dataIsCurrent` to `true`, and sets `hasUnresolvedContradiction` to `false`. This means a user can run the app without verifying the required external conditions and still pass the filter if the technical score is strong enough.

The safer design is to represent each external factor with both a value and a verification state. For example:

```js
{
  macro: { score: null, status: 'NOT_CHECKED', source: null, checkedAt: null },
  crossMarket: { score: null, status: 'NOT_CHECKED', source: null, checkedAt: null }
}
```

A missing or stale required factor should produce `WAIT`, not a neutral 50. A `TRADE` should require every required factor to be verified.

### 2. The app does not return `WAIT`

The specification distinguishes between a trade that fails the setup and information that is not ready. The current `applyTradeFilter` returns only `TRADE`, `NO_TRADE`, or `STOP_TRADING_TODAY`. Add a `WAIT` decision for pending data, unverified macro/news, stale quotes, unresolved cross-market checks, or an open breakout that has not closed for confirmation.

### 3. Current data freshness is not actually checked

The app sets `dataIsCurrent: true` regardless of the provider timestamp. Add a `dataQuality` object containing the latest candle time, quote time, received time, age in seconds, candle gap count, and market-open state. The gate should reject stale or incomplete data.

### 4. Previous-day levels are timeframe-dependent in the wrong way

The current implementation uses `high.slice(-96, -1)` and `low.slice(-96, -1)`. Ninety-six bars represent approximately one day at 15-minute resolution, but not at 5-minute, 1-hour, or 4-hour resolution. The prior day must be derived from timestamps and the instrument’s trading timezone.

### 5. Risk sizing is generic rather than instrument-aware

The position-size calculation accepts a manually entered pip value and stop distance. Gold, indices, forex, and CFD contracts have different point values, tick sizes, contract sizes, and broker lot rules. Add an instrument specification registry with tick size, tick value, contract size, minimum lot, lot step, and maximum lot. Require the user to confirm broker-specific values before sizing.

### 6. The output does not yet match the requested report

The current output omits top setup, competition status, entry zone, numeric stop, target 1, target 2, estimated probability label, confidence, invalidation level, and explicit cancel conditions when the narrative service is unavailable. The app should render a deterministic report even when AI narrative generation is disabled.

## Recommended feature roadmap

### Phase 1: Correctness and trustworthiness

This phase should be completed before adding more indicators.

| Feature | Why it matters | Suggested implementation |
|---|---|---|
| Verified-input states | Prevents neutral defaults from becoming false confirmation. | Replace scalar manual scores with `{score, status, source, checkedAt}` records. |
| Honest decision states | Distinguishes missing information from a rejected setup. | Add `WAIT` and show the exact missing confirmations. |
| Data-quality gate | Prevents decisions from stale or incomplete feeds. | Validate provider time, candle gaps, quote age, market status, and symbol availability. |
| Correct previous-day levels | Prevents incorrect structure and breakout signals. | Group candles by calendar date in the instrument’s timezone. |
| Numeric trade plan | Makes the output executable manually without ambiguity. | Compute entry zone, invalidation, stop, target 1, target 2, and R:R from prices. |
| Instrument-aware sizing | Prevents incorrect lot sizes across asset classes. | Add broker-confirmed contract specifications and lot constraints. |
| Persistent account state | Makes the daily stop meaningful across refreshes. | Store daily P&L and session state locally first, then add authenticated persistence if needed. |

### Phase 2: Complete model coverage

| Feature | Result |
|---|---|
| Session engine | London, New York, and Asia session ranges, opening range, session highs/lows, and session liquidity state. |
| Liquidity-sweep detector | Confirmed sweep and reclaim around prior-day, session, and swing levels. |
| Breakout/retest engine | Close confirmation, retest acceptance/rejection, and maximum chase distance. |
| Cross-market engine | Configurable relationships with timestamped confirmation and contradiction detection. |
| News and calendar integration | Structured event risk with blackout windows before and after high-impact releases. |
| Competition mode | Leaderboard gap, growth, days remaining, and framing state without risk escalation. |
| Symbol scanner | Analyze all supported instruments and rank only valid setups. |
| Backtest and calibration module | Estimate TP-before-SL probability from historical setups, with sample count and out-of-sample validation. |

### Phase 3: Decision quality and resilience

| Feature | Result |
|---|---|
| Cached market data | Reduces Twelve Data usage and improves consistency between quote and candles. |
| Request budgeting | Shows remaining request budget and blocks wasteful polling on the free plan. |
| Multi-source fallback | Clearly labels fallback data rather than silently mixing providers. |
| Trade journal | Records setup, decision, screenshots, outcome, and post-trade review. |
| Scenario analysis | Shows what must change for the decision to move from `NO_TRADE` or `WAIT` to `TRADE`. |
| Model audit log | Stores inputs, scores, source timestamps, and final gate reasons for every analysis. |

## UI/UX recommendations

### Replace the long input form with a staged workflow

The current screen places technical inputs, account inputs, manual scores, and risk inputs into one dense block. A better flow is:

1. **Account and competition:** equity, daily P&L, starting balance, leaderboard data, days remaining.
2. **Market selection:** instrument, timeframe, direction, session, and data status.
3. **Evidence checklist:** macro, news, cross-market, liquidity, and entry trigger.
4. **Risk plan:** entry, stop, targets, contract specification, and maximum permitted risk.
5. **Run analysis:** one primary action that shows a preflight summary before final output.

### Make the decision visually dominant

The final decision should be the first result users see after analysis. Use a large status card with a distinct color and an explanation beneath it:

- **TRADE:** blue or green, with a compact verified-evidence count.
- **WAIT:** amber, with missing confirmations and the next check time.
- **NO TRADE:** muted red or gray, with failed gate conditions.
- **STOP TRADING TODAY:** strong red, with the loss-stop explanation.

Do not rely on color alone. Include text, icons, and accessible contrast.

### Add a preflight data-status strip

Place a compact strip above the chart showing:

```text
Twelve Data: LIVE · quote age 12s · candles complete
Macro: NOT CHECKED
News: NOT CHECKED
Cross-market: VERIFIED 3/3
Session: London · liquid
```

This would make the model’s honesty visible before the user reads the score.

### Show score composition instead of only the total

The current UI shows `SETUP SCORE 0 / 100` but not how it was formed. Add a horizontal factor table or bar chart containing all nine weighted components, each with score, weight, evidence status, and contribution. A high total with a weak macro or liquidity factor should be immediately visible.

### Improve chart usefulness

The chart currently shows candlesticks only. Add optional overlays for EMA20, EMA50, EMA200, VWAP, previous-day high/low, session high/low, entry zone, stop, invalidation, and targets. Add markers for confirmed swings, liquidity sweeps, breakouts, and retests. Keep overlays toggleable so the chart does not become visually noisy.

### Make mobile use a first-class experience

The form uses dense grids that will become cramped on a phone. Use one-column sections on small screens, sticky Run Analysis and final-decision controls, larger touch targets, numeric input steppers, and collapsible evidence sections. Keep the final decision and risk amount visible without requiring a long scroll.

### Improve validation and error handling

Add field-level validation for negative equity, probability outside 0–1, scores outside 0–100, zero stop distance, invalid R:R, unsupported symbols, and inconsistent target direction. Show actionable errors, such as “Set a stop price above zero” or “Verify macro before a trade can be considered.”

### Add a transparent audit drawer

Every result should have a “View calculation” drawer containing provider response time, candle count, data age, formulas, factor scores, gate thresholds, and omitted data. This is more useful than a generic narrative because it lets the user audit the decision.

## Suggested target output

The output should be structured as a decision card followed by an evidence report:

| Section | Required content |
|---|---|
| Decision | `TRADE`, `WAIT`, `NO_TRADE`, or `STOP TRADING TODAY`, with reasons. |
| Data status | Provider, timestamps, age, candle completeness, market/session status. |
| Competition | Balance, growth, days remaining, leaderboard position/gap, risk state. |
| Setup | Symbol, timeframe, regime, direction, trigger, entry zone, invalidation. |
| Trade plan | Stop, target 1, target 2, R:R, probability label, expected R, position size. |
| Score | Nine factor scores, weights, contributions, and evidence status. |
| Context | Macro, news, cross-market, liquidity, and session evidence. |
| Cancellation | Exact conditions that invalidate or cancel the setup. |
| Audit | Source timestamps, formulas, and data-quality warnings. |

## Recommended implementation order

1. **Fix the honesty of the gate:** verified states, `WAIT`, data freshness, contradiction detection, and no neutral defaults.
2. **Fix trade-plan math:** timestamp-aware prior-day levels, numeric entry/stop/targets, expected move, and instrument-aware sizing.
3. **Complete the output:** competition status, score breakdown, evidence checklist, audit drawer, and deterministic cancellation conditions.
4. **Add market context:** sessions, cross-market relationships, calendar, news, and blackout windows.
5. **Improve the chart and responsive layout:** overlays, annotations, mobile workflow, and accessible decision cards.
6. **Add scanning, persistence, journaling, and probability calibration.**

This order protects the user from false confidence before expanding the model’s surface area. The existing application is a good prototype for the technical core, but it should be treated as a **decision-support prototype**, not a complete implementation of the pasted specification, until the missing evidence and gate logic are connected.

## References

[1]: https://twelvedata.com/docs "Twelve Data API documentation"

[2]: https://platform.experientiallabs.ai/docs "Experiential Labs model gateway documentation"


## Implementation update

The application has now been upgraded in the following areas:

| Implemented update | Result |
|---|---|
| Honest evidence states | Macro, cross-market, entry-quality, and liquidity/session inputs now have `NOT_CHECKED`, `VERIFIED`, `STALE`, and `CONTRADICTED` states. |
| `WAIT` decision | Missing or unverified required evidence now produces `WAIT` instead of silently treating the input as confirmed. |
| Data-quality gate | Provider quote age, candle count, market-open state, and timestamp availability are included in the gate and audit output. |
| Timestamp-aware prior-day levels | Previous-day high and low are derived from candle dates instead of a fixed 96-bar assumption. |
| Trade-plan math | Entry zone, stop/invalidation, Target 1, Target 2, expected move, R:R, and expected R are displayed. |
| Competition panel | Starting balance, equity, growth, daily P&L, days remaining, leaderboard position, and competition mode are persisted and displayed. |
| Persistence | Account and evidence settings survive a browser refresh through local storage. |
| Score transparency | All nine factors now display score, weight contribution, and a visual bar. |
| Chart overlays | EMA20, EMA50, EMA200, VWAP, entry, stop, and targets are shown on the chart. |
| Responsive workflow | The dashboard is organized into account, market, evidence, risk, decision, and audit sections with mobile-friendly controls. |
| Audit drawer | The output includes a raw calculation audit containing quote, indicator, data-quality, and gate information. |
| Private data key | Twelve Data remains behind `/api/market-data` and uses the server-only `TWELVEDATA_API_KEY`. |

The remaining product-level work is primarily external-data integration and validation: connecting a source-backed economic calendar and news provider, implementing automated cross-market relationships, adding a calibrated historical probability model, and adding a multi-symbol scanner that respects the Twelve Data free-tier request budget. These should be added only with explicit source, timestamp, caching, and rate-limit handling.
