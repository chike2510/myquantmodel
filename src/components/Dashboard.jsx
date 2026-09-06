import { useEffect, useState } from 'react';
import { fetchCandles, fetchQuote, fetchCrossMarketQuotes, SYMBOLS } from '../api/marketData';
import { computeIndicators, classifyRegime } from '../engine/indicators';
import { deriveAutoSubscores, scoreRiskReward } from '../engine/deriveSubscores';
import { applyTradeFilter, calculatePositionSize, calculateTradePlan, classifyCompetitionState, computeSetupScore, expectancy, riskTierFor, scoreBreakdown } from '../engine/setupScore';
import { backtestTrendSetups } from '../engine/backtest';
import LiveChart from './LiveChart';

const TIMEFRAMES = ['4H', '1H', '15M', '5M'];
const initialEvidence = { macro: { score: 50, status: 'NOT_CHECKED', note: '' }, crossMarket: { score: 50, status: 'NOT_CHECKED', note: '' }, entryQuality: { score: 50, status: 'NOT_CHECKED', note: '' }, liquiditySession: { score: 50, status: 'NOT_CHECKED', note: '' } };
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

export default function Dashboard() {
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('1H');
  const [equity, setEquity] = useState(() => load('fq-equity', 100000));
  const [startingBalance, setStartingBalance] = useState(() => load('fq-starting', 100000));
  const [dailyPnLPct, setDailyPnLPct] = useState(() => load('fq-daily-pnl', 0));
  const [direction, setDirection] = useState('LONG');
  const [evidence, setEvidence] = useState(() => load('fq-evidence', initialEvidence));
  const [stopDistance, setStopDistance] = useState(50);
  const [pipValuePerLot, setPipValuePerLot] = useState(10);
  const [rrInput, setRrInput] = useState(2);
  const [probabilityInput, setProbabilityInput] = useState(0.6);
  const [leaderboardPosition, setLeaderboardPosition] = useState('');
  const [top10Position, setTop10Position] = useState('');
  const [daysRemaining, setDaysRemaining] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', text: 'I’m ready. Tell me what you want to analyze, or type “analyze” after reviewing the context cards below. I will never invent missing market evidence.' }]);
  const growthPct = startingBalance ? ((equity - startingBalance) / startingBalance) * 100 : 0;

  useEffect(() => { localStorage.setItem('fq-equity', JSON.stringify(equity)); }, [equity]);
  useEffect(() => { localStorage.setItem('fq-starting', JSON.stringify(startingBalance)); }, [startingBalance]);
  useEffect(() => { localStorage.setItem('fq-daily-pnl', JSON.stringify(dailyPnLPct)); }, [dailyPnLPct]);
  useEffect(() => { localStorage.setItem('fq-evidence', JSON.stringify(evidence)); }, [evidence]);

  async function runAnalysis() {
    setLoading(true); setError(null);
    try {
      const marketSymbol = SYMBOLS[symbol];
      const crossSymbols = crossMarketSymbols(symbol);
      const [{ candles, fetchedAt, source }, quote, crossQuotes, calendar, news] = await Promise.all([
        fetchCandles(marketSymbol, timeframe, 300), fetchQuote(marketSymbol),
        fetchCrossMarketQuotes(crossSymbols).catch(() => []),
        fetch('/api/context?action=calendar').then(r => r.json()).catch(() => ({ configured: false, events: [] })),
        fetch('/api/context?action=news').then(r => r.json()).catch(() => ({ configured: false, news: [] })),
      ]);
      const ind = computeIndicators(candles);
      if (ind.insufficientData) throw new Error(`Only ${ind.candleCount} candles returned. Need 210+ for EMA200.`);
      const regime = classifyRegime(ind);
      const auto = deriveAutoSubscores(ind, regime, direction);
      const rrScore = scoreRiskReward(rrInput);
      const manualScores = Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, value.score]));
      const subscores = { ...auto, ...manualScores, riskReward: rrScore };
      const setupScore = computeSetupScore(subscores);
      const providerTime = quote.lastQuoteAt ? new Date(quote.lastQuoteAt).getTime() : 0;
      const ageSeconds = providerTime ? Math.max(0, (Date.now() - providerTime) / 1000) : Infinity;
      const dataQuality = { current: ageSeconds < 1800, ageSeconds, candleCount: candles.length, currentQuote: quote.isMarketOpen, reason: providerTime ? `Quote age ${Math.round(ageSeconds / 60)}m exceeds freshness limit` : 'Provider timestamp unavailable' };
      const plan = calculateTradePlan({ price: quote.price, direction, atr: ind.atr14, rr: rrInput, stopDistance });
      const regimeSupportsSetup = (direction === 'LONG' && ['TREND_UP', 'BREAKOUT'].includes(regime)) || (direction === 'SHORT' && ['TREND_DOWN', 'BREAKOUT'].includes(regime));
      const contradictionReasons = [];
      if (direction === 'LONG' && ind.diMinus > ind.diPlus && regime === 'TREND_UP') contradictionReasons.push('Directional indicators conflict with the selected long bias');
      if (direction === 'SHORT' && ind.diPlus > ind.diMinus && regime === 'TREND_DOWN') contradictionReasons.push('Directional indicators conflict with the selected short bias');
      const verified = Object.entries(evidence).map(([key, value]) => ({ key, status: value.status }));
      const planComplete = plan.stopDistance > 0 && plan.target1 > 0 && plan.target2 > 0 && pipValuePerLot > 0;
      const filter = applyTradeFilter({ setupScore, probability: probabilityInput, riskReward: rrInput, dataQuality, verified, regimeSupportsSetup, contradictionReasons, dailyPnLPct: dailyPnLPct / 100, planComplete });
      const { tier, risk } = riskTierFor(setupScore);
      const position = calculatePositionSize({ equity, riskPct: risk, stopDistancePips: stopDistance, pipValuePerLot });
      let narrative = null;
      try {
        const response = await fetch('/api/narrative', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ computed: { symbol, timeframe, regime, setupScore, decision: filter.decision, reasons: filter.reasons, probability: probabilityInput, riskReward: rrInput, indicators: ind, plan, direction, riskTier: tier, dataQuality }, macroContext: evidence.macro.note, crossMarketContext: evidence.crossMarket.note }) });
        const data = await response.json(); narrative = data.narrative ?? null;
      } catch { narrative = null; }
      setResult({ candles, fetchedAt, source, quote, ind, regime, setupScore, subscores, breakdown: scoreBreakdown(subscores), filter, tier, risk, position, narrative, plan, expectancy: expectancy(probabilityInput, rrInput), dataQuality, crossQuotes, calendar, news, backtest: backtestTrendSetups(candles), competition: classifyCompetitionState({ growthPct, leaderboardGapPct: top10Position ? Number(top10Position) : null }) });
    } catch (e) { setError(String(e.message || e)); }
    finally { setLoading(false); }
  }

  async function scanShortlist() {
    setScanning(true); setError(null);
    try {
      const shortlist = ['XAUUSD', 'EURUSD', 'USDJPY'];
      const rows = [];
      for (const item of shortlist) {
        const { candles } = await fetchCandles(SYMBOLS[item], timeframe, 220);
        const ind = computeIndicators(candles);
        if (ind.insufficientData) continue;
        const regime = classifyRegime(ind);
        const longAuto = deriveAutoSubscores(ind, regime, 'LONG');
        const shortAuto = deriveAutoSubscores(ind, regime, 'SHORT');
        const base = { crossMarket: 50, macro: 50, entryQuality: 50, liquiditySession: 50, riskReward: scoreRiskReward(2) };
        const longScore = computeSetupScore({ ...longAuto, ...base });
        const shortScore = computeSetupScore({ ...shortAuto, ...base });
        const chosen = longScore >= shortScore ? ['LONG', longScore] : ['SHORT', shortScore];
        rows.push({ symbol: item, direction: chosen[0], score: chosen[1], regime, note: 'Technical shortlist only; verify context before trading' });
      }
      setScanResults(rows.sort((a, b) => b.score - a.score));
    } catch (e) { setError(String(e.message || e)); }
    finally { setScanning(false); }
  }

  async function sendChat(event) {
    event?.preventDefault();
    const text = chatInput.trim();
    if (!text || loading || scanning) return;
    setMessages(prev => [...prev, { role: 'user', text }]);
    setChatInput('');
    if (/\b(scan|shortlist)\b/i.test(text)) {
      setMessages(prev => [...prev, { role: 'assistant', text: 'Scanning the three-symbol technical shortlist. This uses three Twelve Data candle requests and still requires context verification.' }]);
      await scanShortlist();
    } else if (/\b(analy[sz]e|run|check)\b/i.test(text)) {
      setMessages(prev => [...prev, { role: 'assistant', text: `Checking ${symbol} on ${timeframe}. I’ll return a deterministic decision with data age, score breakdown, risk plan, and missing-evidence warnings.` }]);
      await runAnalysis();
      setMessages(prev => [...prev, { role: 'assistant', text: 'Analysis complete. The decision card and audit report are below. Review the evidence status before acting.' }]);
    } else {
      setMessages(prev => [...prev, { role: 'assistant', text: 'I can run an analysis or scan the technical shortlist. Try: “Analyze XAUUSD” or “scan the shortlist.” Use the context cards below to change the instrument, evidence, and risk inputs.' }]);
    }
  }

  const updateEvidence = (key, patch) => setEvidence(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const dataAgeText = result ? (result.dataQuality.current ? `${Math.round(result.dataQuality.ageSeconds)}s old` : 'STALE') : 'Not checked';
  return <main className="min-h-screen bg-[#080C14] text-[#E7EAF0] font-sans"><div className="max-w-5xl mx-auto px-3 sm:px-6 py-4 sm:py-8">
    <header className="flex flex-wrap items-center justify-between gap-3 mb-5"><div><div className="text-xs tracking-[0.3em] text-[#F0A500] uppercase">FundedNext Quant</div><h1 className="text-2xl sm:text-3xl font-semibold tracking-tight mt-1">Your trading decision room</h1><p className="text-[#8A93A6] mt-1 text-sm">Ask for an analysis. You execute every trade manually.</p></div><div className="text-right text-xs text-[#8A93A6]">{symbol} · {timeframe}<br />DATA: {dataAgeText}</div></header>
    <section className="chat-shell"><div className="chat-scroll">{messages.map((message, index) => <div key={`${message.role}-${index}`} className={`chat-row ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}><div className={message.role === 'user' ? 'user-bubble' : 'assistant-bubble'}><div className="text-[10px] uppercase tracking-widest opacity-60 mb-1">{message.role === 'user' ? 'YOU' : 'QUANT ASSISTANT'}</div>{message.text}</div></div>)}{result && <div className="assistant-bubble w-full max-w-none space-y-4"><DecisionBanner result={result} /><LiveChart candles={result.candles} indicators={result.ind} plan={result.plan} /><OutputBlock symbol={symbol} timeframe={timeframe} equity={equity} result={result} /></div>}{error && <div className="rounded-lg border border-red-400/40 bg-red-400/10 p-4 text-sm text-red-200">{error}</div>}</div><form onSubmit={sendChat} className="chat-composer"><input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask: Analyze XAUUSD, scan the shortlist…" className="chat-input" disabled={loading || scanning} /><button className="primary chat-send" disabled={loading || scanning || !chatInput.trim()}>{loading ? '…' : 'Send'}</button></form></section>
    <details className="mt-4 context-drawer"><summary>Context cards · account, market, evidence, and risk settings</summary><div className="space-y-4 mt-4"><AccountPanel equity={equity} setEquity={setEquity} startingBalance={startingBalance} setStartingBalance={setStartingBalance} dailyPnLPct={dailyPnLPct} setDailyPnLPct={setDailyPnLPct} daysRemaining={daysRemaining} setDaysRemaining={setDaysRemaining} leaderboardPosition={leaderboardPosition} setLeaderboardPosition={setLeaderboardPosition} top10Position={top10Position} setTop10Position={setTop10Position} growthPct={growthPct} /><section className="panel"><div className="section-title">MARKET AND SCANNER</div><div className="grid grid-cols-2 md:grid-cols-4 gap-3"><Field label="Instrument"><select value={symbol} onChange={e => setSymbol(e.target.value)} className={control}>{Object.keys(SYMBOLS).map(s => <option key={s}>{s}</option>)}</select></Field><Field label="Timeframe"><select value={timeframe} onChange={e => setTimeframe(e.target.value)} className={control}>{TIMEFRAMES.map(t => <option key={t}>{t}</option>)}</select></Field><Field label="Direction"><select value={direction} onChange={e => setDirection(e.target.value)} className={control}><option>LONG</option><option>SHORT</option></select></Field><Field label="Stop distance"><input type="number" min="0" step="0.01" value={stopDistance} onChange={e => setStopDistance(Number(e.target.value))} className={control} /></Field></div><button onClick={scanShortlist} disabled={scanning} className="secondary mt-4">{scanning ? 'Scanning…' : 'Scan technical shortlist'}</button>{scanResults.length > 0 && <div className="mt-4 grid md:grid-cols-3 gap-3">{scanResults.map(row => <button key={row.symbol} onClick={() => { setSymbol(row.symbol); setDirection(row.direction); }} className="text-left rounded-md border border-[#1E2636] bg-[#080C14] p-3 hover:border-[#2563EB]"><div className="flex justify-between"><b>{row.symbol}</b><span className="text-[#F0A500]">{row.score}/100</span></div><div className="text-xs text-[#8A93A6] mt-1">{row.direction} · {row.regime}</div><div className="text-[10px] text-[#8A93A6] mt-2">Technical shortlist only</div></button>)}</div>}</section><section className="panel"><div className="section-title">EVIDENCE CHECKLIST</div><p className="hint">Scores count as confirmation only when marked VERIFIED.</p><div className="grid md:grid-cols-2 gap-3">{Object.entries(evidence).map(([key, value]) => <Evidence key={key} name={key} value={value} onChange={patch => updateEvidence(key, patch)} />)}</div></section><section className="panel"><div className="section-title">RISK AND PLAN</div><div className="grid grid-cols-2 md:grid-cols-3 gap-3"><Field label="Estimated probability"><input type="number" min="0" max="1" step="0.01" value={probabilityInput} onChange={e => setProbabilityInput(Number(e.target.value))} className={control} /></Field><Field label="Target R:R"><input type="number" min="0" step="0.1" value={rrInput} onChange={e => setRrInput(Number(e.target.value))} className={control} /></Field><Field label="Value per lot ($)"><input type="number" min="0" step="0.01" value={pipValuePerLot} onChange={e => setPipValuePerLot(Number(e.target.value))} className={control} /></Field></div></section></div></details>
    <footer className="text-xs text-[#8A93A6] mt-5 text-center">Decision support only. No automated execution, copy trading, HFT, grid trading, account sharing, or gambling behavior.</footer>
  </div></main>;
}

function AccountPanel(p) { return <section className="panel"><div className="section-title">ACCOUNT AND COMPETITION</div><div className="grid grid-cols-2 md:grid-cols-6 gap-3"><Field label="Starting balance"><input type="number" value={p.startingBalance} onChange={e => p.setStartingBalance(Number(e.target.value))} className={control} /></Field><Field label="Current equity"><input type="number" value={p.equity} onChange={e => p.setEquity(Number(e.target.value))} className={control} /></Field><Field label="Daily P&L (%)"><input type="number" step="0.1" value={p.dailyPnLPct} onChange={e => p.setDailyPnLPct(Number(e.target.value))} className={control} /></Field><Field label="Days remaining"><input type="number" value={p.daysRemaining} onChange={e => p.setDaysRemaining(e.target.value)} className={control} /></Field><Field label="Leaderboard position"><input type="number" value={p.leaderboardPosition} onChange={e => p.setLeaderboardPosition(e.target.value)} className={control} /></Field><Field label="Top-10 gap (%)"><input type="number" step="0.1" value={p.top10Position} onChange={e => p.setTop10Position(e.target.value)} className={control} /></Field></div><div className="mt-3 text-xs text-[#8A93A6]">Growth: <b className="text-white">{p.growthPct.toFixed(2)}%</b> · Internal stop: <b className="text-[#F0A500]">-2%</b> · Competition mode is framing only and never raises risk.</div></section>; }
function Evidence({ name, value, onChange }) { return <div className="rounded-md border border-[#1E2636] bg-[#080C14] p-3"><div className="flex justify-between items-center gap-2"><label className="text-sm capitalize">{name.replace(/([A-Z])/g, ' $1')}</label><select value={value.status} onChange={e => onChange({ status: e.target.value })} className="bg-[#0C111C] border border-[#1E2636] rounded px-2 py-1 text-xs"><option>NOT_CHECKED</option><option>VERIFIED</option><option>STALE</option><option>CONTRADICTED</option></select></div><div className="grid grid-cols-3 gap-2 mt-2"><input type="number" min="0" max="100" value={value.score} onChange={e => onChange({ score: Number(e.target.value) })} className={control} placeholder="Score" /><input value={value.note} onChange={e => onChange({ note: e.target.value })} className={`${control} col-span-2`} placeholder="Source / observation" /></div></div>; }
function DecisionBanner({ result }) { const colors = { TRADE: 'border-blue-400 bg-blue-400/10 text-blue-200', WAIT: 'border-amber-400 bg-amber-400/10 text-amber-200', NO_TRADE: 'border-slate-400 bg-slate-400/10 text-slate-200', STOP_TRADING_TODAY: 'border-red-400 bg-red-400/10 text-red-200' }; return <div className={`rounded-xl border p-5 ${colors[result.filter.decision]}`}><div className="text-xs tracking-widest uppercase">FINAL DECISION</div><div className="text-3xl font-bold mt-1">{result.filter.decision.replaceAll('_', ' ')}</div><div className="text-sm mt-2">{result.filter.reasons.length ? result.filter.reasons.join(' · ') : 'All required gates passed.'}</div></div>; }
function OutputBlock({ symbol, timeframe, equity, result }) { const { quote, ind, regime, setupScore, filter, tier, risk, position, narrative, plan, breakdown, expectancy: exp, competition, dataQuality, crossQuotes, calendar, news, backtest } = result; return <section className="panel space-y-5"><div className="text-center text-[#F0A500] tracking-widest text-xs">FUNDEDNEXT QUANT · AUDITABLE REPORT</div><div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">{[['SYMBOL / TIMEFRAME', `${symbol} / ${timeframe}`], ['CURRENT PRICE', quote.price], ['REGIME', regime], ['DATA AGE', `${Math.round(dataQuality.ageSeconds)}s`], ['ENTRY ZONE', `${plan.entryZone.low.toFixed(5)} – ${plan.entryZone.high.toFixed(5)}`], ['STOP / INVALIDATION', plan.stop.toFixed(5)], ['TARGET 1', plan.target1.toFixed(5)], ['TARGET 2', plan.target2.toFixed(5)], ['R:R', plan.rr.toFixed(2)], ['EXPECTED R', exp.toFixed(2)], ['SETUP SCORE', `${setupScore} / 100`], ['RISK TIER', tier === 'none' ? 'NONE' : `${tier} ${(risk * 100).toFixed(2)}%`], ['RISK AMOUNT', `$${position.riskAmount.toLocaleString()}`], ['POSITION SIZE', `${position.lots} lots`], ['SESSION', ind.session.name], ['COMPETITION MODE', competition]].map(([label, value]) => <Row key={label} label={label} value={value} />)}</div><div><h2 className="section-title">SCORE BREAKDOWN</h2><div className="space-y-2">{breakdown.map(item => <div key={item.key} className="grid grid-cols-[1fr_3fr_auto] gap-2 items-center text-xs"><span className="text-[#8A93A6] capitalize">{item.key.replace(/([A-Z])/g, ' $1')}</span><div className="h-2 bg-[#1E2636] rounded"><div className="h-2 bg-[#2563EB] rounded" style={{ width: `${item.score}%` }} /></div><span>{item.score} · +{item.contribution}</span></div>)}</div></div><div className="grid md:grid-cols-3 gap-3"><Row label="CROSS-MARKET QUOTES" value={`${crossQuotes.length} loaded`} /><Row label="CALENDAR" value={calendar.configured ? `${calendar.events?.length || 0} events` : 'Provider not configured'} /><Row label="NEWS" value={news.configured ? `${news.news?.length || 0} headlines` : 'Provider not configured'} /></div><div><h2 className="section-title">HISTORICAL CHECK</h2><p className="text-sm text-[#C4C9D4]">{backtest.available ? `${backtest.sampleSize} comparable trend observations · ${(backtest.winRate * 100).toFixed(1)}% hit rate · ${backtest.expectancyR.toFixed(2)}R sample expectancy` : `Backtest unavailable or too small: ${backtest.reason || 'fewer than 10 observations'}.`}</p></div><div><h2 className="section-title">CANCEL / INVALIDATION</h2><p className="text-sm text-[#C4C9D4]">Cancel if price reaches {plan.invalidation.toFixed(5)}, the selected evidence becomes contradicted, the quote becomes stale, or the setup no longer meets the 75 score / 60% probability / 1.5 R:R gates.</p></div>{narrative && <div className="border-t border-[#1E2636] pt-4 space-y-3">{[['WHY', narrative.why], ['MACRO', narrative.macro], ['CROSS-MARKET', narrative.crossMarket], ['INVALIDATION', narrative.invalidation]].map(([title, text]) => text && <div key={title}><div className="text-xs text-[#8A93A6] uppercase tracking-wide">{title}</div><p className="text-sm leading-relaxed mt-1">{text}</p></div>)}</div>}<details className="border-t border-[#1E2636] pt-3"><summary className="cursor-pointer text-sm text-[#8A93A6]">View calculation audit</summary><pre className="mt-3 overflow-auto text-xs text-[#8A93A6]">{JSON.stringify({ quote, indicators: ind, filter, dataQuality, crossQuotes, calendar, news, backtest }, null, 2)}</pre></details></section>; }

function crossMarketSymbols(symbol) { const map = { XAUUSD: ['XAG/USD', 'USD/JPY', 'EUR/USD'], NAS100: ['DJI', 'XAU/USD', 'USD/JPY'], US30: ['NDX', 'XAU/USD', 'USD/JPY'], GER30: ['NDX', 'EUR/USD', 'XAU/USD'], EURUSD: ['USD/JPY', 'GBP/USD', 'XAU/USD'], GBPUSD: ['EUR/USD', 'USD/JPY', 'XAU/USD'], USDJPY: ['EUR/USD', 'XAU/USD', 'NDX'], AUDUSD: ['XAU/USD', 'USD/CAD', 'NDX'], USDCAD: ['USD/JPY', 'XAU/USD', 'AUD/USD'], XAGUSD: ['XAU/USD', 'USD/JPY', 'EUR/USD'] }; return map[symbol] || ['EUR/USD', 'USD/JPY']; }
function Row({ label, value }) { return <div className="rounded-md bg-[#080C14] border border-[#1E2636] p-3"><div className="text-[10px] text-[#8A93A6]">{label}</div><div className="text-sm mt-1 break-words">{value}</div></div>; }
function Field({ label, children }) { return <label className="block"><span className="block text-xs text-[#8A93A6] mb-1">{label}</span>{children}</label>; }
const control = 'control w-full rounded-md bg-[#0C111C] border border-[#1E2636] px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-[#2563EB]';
