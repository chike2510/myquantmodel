import { useState } from 'react';
import { fetchCandles, fetchQuote, SYMBOLS } from '../api/marketData';
import { computeIndicators, classifyRegime } from '../engine/indicators';
import { deriveAutoSubscores, scoreRiskReward } from '../engine/deriveSubscores';
import { computeSetupScore, applyTradeFilter, riskTierFor, calculatePositionSize } from '../engine/setupScore';
import LiveChart from './LiveChart';

const TIMEFRAMES = ['4H', '1H', '15M', '5M'];

export default function Dashboard() {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('1H');
  const [equity, setEquity] = useState(100000);
  const [dailyPnLPct, setDailyPnLPct] = useState(0);
  const [direction, setDirection] = useState('LONG');
  const [manualScores, setManualScores] = useState({ crossMarket: 50, macro: 50, entryQuality: 50, liquiditySession: 50 });
  const [stopDistancePips, setStopDistancePips] = useState(50);
  const [pipValuePerLot, setPipValuePerLot] = useState(10);
  const [rrInput, setRrInput] = useState(2);
  const [probabilityInput, setProbabilityInput] = useState(0.6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  async function runAnalysis() {
    setLoading(true);
    setError(null);
    try {
      const { candles, fetchedAt, source } = await fetchCandles(SYMBOLS[symbol], timeframe, 300);
      const quote = await fetchQuote(SYMBOLS[symbol]);
      const ind = computeIndicators(candles);

      if (ind.insufficientData) {
        setError(`Only ${ind.candleCount} candles returned — need 210+ for EMA200. Try a lower timeframe or wait for more history.`);
        setLoading(false);
        return;
      }

      const regime = classifyRegime(ind);
      const auto = deriveAutoSubscores(ind, regime, direction);
      const riskReward = scoreRiskReward(rrInput);

      const subscores = { ...auto, ...manualScores, riskReward };
      const setupScore = computeSetupScore(subscores);

      const regimeSupportsSetup =
        (direction === 'LONG' && ['TREND_UP', 'BREAKOUT'].includes(regime)) ||
        (direction === 'SHORT' && ['TREND_DOWN', 'BREAKOUT'].includes(regime));

      const filter = applyTradeFilter({
        setupScore,
        probability: probabilityInput,
        riskReward: rrInput,
        dataIsCurrent: true,
        regimeSupportsSetup,
        hasUnresolvedContradiction: false,
        dailyPnLPct: dailyPnLPct / 100,
      });

      const { tier, risk } = riskTierFor(setupScore);
      const position = calculatePositionSize({
        equity,
        riskPct: risk,
        stopDistancePips,
        pipValuePerLot,
      });

      let narrative = null;
      try {
        const narrRes = await fetch('/api/narrative', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            computed: {
              symbol, timeframe, regime, setupScore, decision: filter.decision,
              reasons: filter.reasons, probability: probabilityInput, riskReward: rrInput,
              indicators: ind, direction, riskTier: tier,
            },
          }),
        });
        const narrData = await narrRes.json();
        narrative = narrData.narrative ?? null;
      } catch {
        narrative = null; // narrative is optional flavor text; the gate above already stands without it
      }

      setResult({
        candles, fetchedAt, source, quote, ind, regime, setupScore, filter,
        tier, risk, position, narrative, rrInput,
      });
    } catch (e) {
      setError(String(e.message || e));
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#080C14] text-[#E7EAF0] font-sans">
      <div className="max-w-5xl mx-auto px-6 py-10 space-y-8">
        <header className="border-b border-[#1E2636] pb-6">
          <h1 className="text-3xl font-semibold tracking-tight">
            FundedNext Quant <span className="text-[#F0A500]">— Decision Support</span>
          </h1>
          <p className="text-[#8A93A6] mt-1 text-sm">
            Manual-trading decision support. You execute every trade yourself.
          </p>
        </header>

        <Controls
          symbol={symbol} setSymbol={setSymbol}
          timeframe={timeframe} setTimeframe={setTimeframe}
          equity={equity} setEquity={setEquity}
          dailyPnLPct={dailyPnLPct} setDailyPnLPct={setDailyPnLPct}
          direction={direction} setDirection={setDirection}
          manualScores={manualScores} setManualScores={setManualScores}
          stopDistancePips={stopDistancePips} setStopDistancePips={setStopDistancePips}
          pipValuePerLot={pipValuePerLot} setPipValuePerLot={setPipValuePerLot}
          rrInput={rrInput} setRrInput={setRrInput}
          probabilityInput={probabilityInput} setProbabilityInput={setProbabilityInput}
          onRun={runAnalysis} loading={loading}
        />

        {error && (
          <div className="rounded-lg border border-[#F0A500]/40 bg-[#F0A500]/5 p-4 text-sm text-[#F0A500]">
            {error}
          </div>
        )}

        {result && (
          <>
            <LiveChart candles={result.candles} />
            <OutputBlock symbol={symbol} timeframe={timeframe} equity={equity} result={result} />
          </>
        )}
      </div>
    </div>
  );
}

function Controls(props) {
  const {
    symbol, setSymbol, timeframe, setTimeframe, equity, setEquity,
    dailyPnLPct, setDailyPnLPct, direction, setDirection,
    manualScores, setManualScores, stopDistancePips, setStopDistancePips,
    pipValuePerLot, setPipValuePerLot, rrInput, setRrInput,
    probabilityInput, setProbabilityInput, onRun, loading,
  } = props;

  return (
    <div className="rounded-lg border border-[#1E2636] bg-[#0C111C] p-5 space-y-5">
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="Symbol">
          <select value={symbol} onChange={e => setSymbol(e.target.value)} className={selectCls}>
            {Object.keys(SYMBOLS).map(s => <option key={s} value={s}>{s}</option>)}
          </select>
        </Field>
        <Field label="Timeframe">
          <select value={timeframe} onChange={e => setTimeframe(e.target.value)} className={selectCls}>
            {TIMEFRAMES.map(t => <option key={t} value={t}>{t}</option>)}
          </select>
        </Field>
        <Field label="Direction">
          <select value={direction} onChange={e => setDirection(e.target.value)} className={selectCls}>
            <option value="LONG">LONG</option>
            <option value="SHORT">SHORT</option>
          </select>
        </Field>
        <Field label="Account equity ($)">
          <input type="number" value={equity} onChange={e => setEquity(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        <Field label="Daily P&L so far (%)">
          <input type="number" step="0.1" value={dailyPnLPct} onChange={e => setDailyPnLPct(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Stop distance (pips)">
          <input type="number" value={stopDistancePips} onChange={e => setStopDistancePips(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Pip value / lot ($)">
          <input type="number" value={pipValuePerLot} onChange={e => setPipValuePerLot(Number(e.target.value))} className={inputCls} />
        </Field>
        <Field label="Target R:R">
          <input type="number" step="0.1" value={rrInput} onChange={e => setRrInput(Number(e.target.value))} className={inputCls} />
        </Field>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        <Field label="Est. probability (0-1)">
          <input type="number" step="0.01" value={probabilityInput} onChange={e => setProbabilityInput(Number(e.target.value))} className={inputCls} />
        </Field>
        {['crossMarket', 'macro', 'entryQuality', 'liquiditySession'].map(key => (
          <Field key={key} label={labelFor(key)}>
            <input
              type="number" min={0} max={100}
              value={manualScores[key]}
              onChange={e => setManualScores(m => ({ ...m, [key]: Number(e.target.value) }))}
              className={inputCls}
            />
          </Field>
        ))}
      </div>
      <p className="text-xs text-[#8A93A6]">
        Cross-market, macro, entry quality, and liquidity/session are scored 0–100 by you from real
        calendar/news/cross-asset checks — this tool doesn't fabricate those, it only refuses to
        recommend a trade if you leave them unexamined.
      </p>

      <button
        onClick={onRun} disabled={loading}
        className="w-full rounded-md bg-[#2563EB] hover:bg-[#2563EB]/90 disabled:opacity-50 text-white font-medium py-2.5 transition-colors"
      >
        {loading ? 'Analyzing…' : 'Run Analysis'}
      </button>
    </div>
  );
}

function labelFor(key) {
  return {
    crossMarket: 'Cross-market (0-100)',
    macro: 'Macro (0-100)',
    entryQuality: 'Entry quality (0-100)',
    liquiditySession: 'Liquidity/session (0-100)',
  }[key];
}

function Field({ label, children }) {
  return (
    <label className="block">
      <span className="block text-xs text-[#8A93A6] mb-1">{label}</span>
      {children}
    </label>
  );
}

const inputCls = "w-full rounded-md bg-[#0C111C] border border-[#1E2636] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]";
const selectCls = inputCls;

function OutputBlock({ symbol, timeframe, equity, result }) {
  const { fetchedAt, source, quote, ind, regime, setupScore, filter, tier, risk, position, narrative } = result;
  const decisionColor = {
    TRADE: 'text-[#2563EB]',
    WAIT: 'text-[#F0A500]',
    NO_TRADE: 'text-[#8A93A6]',
    STOP_TRADING_TODAY: 'text-red-400',
  }[filter.decision];

  return (
    <div className="rounded-lg border border-[#1E2636] bg-[#0C111C] p-6 space-y-6 font-mono text-sm">
      <div className="text-center text-[#F0A500] tracking-widest text-xs">FUNDEDNEXT QUANT</div>

      <Row label="DATE/TIME" value={`${fetchedAt} (${source})`} />
      <Row label="ACCOUNT" value={`$${equity.toLocaleString()}`} />
      <Row label="MARKET REGIME" value={regime} />
      <Row label="SYMBOL / TIMEFRAME" value={`${symbol} / ${timeframe}`} />
      <Row label="CURRENT PRICE" value={`${quote.price} (verified ${quote.timestamp})`} />
      <Row label="R:R" value={result.rrInput ?? '—'} />
      <Row label="SETUP SCORE" value={`${setupScore} / 100`} />
      <Row label="RISK TIER" value={tier === 'none' ? '— (below threshold)' : `${tier} (${(risk * 100).toFixed(2)}%)`} />
      {tier !== 'none' && (
        <>
          <Row label="RISK AMOUNT" value={`$${position.riskAmount.toLocaleString()}`} />
          <Row label="POSITION SIZE" value={`${position.lots} lots${position.cappedByMaxLots ? ' (capped)' : ''}`} />
        </>
      )}

      <div className="pt-3 border-t border-[#1E2636]">
        <span className="text-xs text-[#8A93A6]">FINAL</span>
        <div className={`text-lg font-semibold ${decisionColor}`}>{filter.decision.replace('_', ' ')}</div>
        {filter.reasons.length > 0 && (
          <ul className="mt-2 text-xs text-[#8A93A6] list-disc list-inside space-y-0.5">
            {filter.reasons.map((r, i) => <li key={i}>{r}</li>)}
          </ul>
        )}
      </div>

      {narrative && (
        <div className="pt-3 border-t border-[#1E2636] space-y-3 text-[#C4C9D4] font-sans">
          <NarrativeSection title="WHY" text={narrative.why} />
          <NarrativeSection title="MACRO" text={narrative.macro} />
          <NarrativeSection title="CROSS-MARKET" text={narrative.crossMarket} />
          <NarrativeSection title="INVALIDATION" text={narrative.invalidation} />
          <NarrativeSection title="WHAT WOULD CANCEL THIS" text={narrative.cancelConditions} />
        </div>
      )}

      <p className="text-xs text-[#8A93A6] pt-2 border-t border-[#1E2636]">
        Decision support only. You execute all trades manually. Not financial advice.
      </p>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between text-xs">
      <span className="text-[#8A93A6]">{label}</span>
      <span>{value}</span>
    </div>
  );
}

function NarrativeSection({ title, text }) {
  if (!text) return null;
  return (
    <div>
      <div className="text-xs text-[#8A93A6] uppercase tracking-wide mb-1">{title}</div>
      <p className="text-sm leading-relaxed">{text}</p>
    </div>
  );
}
