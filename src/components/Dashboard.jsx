import { useEffect, useMemo, useState } from 'react';
import { fetchCandles, fetchQuote, fetchCrossMarketQuotes, SYMBOLS } from '../api/marketData';
import { computeIndicators, classifyRegime } from '../engine/indicators';
import { deriveAutoSubscores, scoreRiskReward } from '../engine/deriveSubscores';
import { applyTradeFilter, calculatePositionSize, calculateTradePlan, classifyCompetitionState, computeSetupScore, expectancy, riskTierFor, scoreBreakdown } from '../engine/setupScore';
import { backtestTrendSetups } from '../engine/backtest';
import LiveChart from './LiveChart';

const TIMEFRAMES = ['4H', '1H', '15M', '5M'];
const NAV = [['office', '⌂', 'Office'], ['markets', '◈', 'Markets'], ['chat', '◌', 'Chat'], ['coding', '</>', 'Coding'], ['strategies', '⌁', 'Strategies'], ['portfolio', '▥', 'Portfolio']];
const AGENTS = [{ name: 'Rhea', role: 'Coordinator', color: 'violet', status: 'online' }, { name: 'Atlas', role: 'Market research', color: 'blue', status: 'working' }, { name: 'Noor', role: 'Risk reviewer', color: 'amber', status: 'ready' }, { name: 'Sable', role: 'Execution planner', color: 'emerald', status: 'ready' }];
const initialEvidence = { macro: { score: 50, status: 'NOT_CHECKED', note: '' }, crossMarket: { score: 50, status: 'NOT_CHECKED', note: '' }, entryQuality: { score: 50, status: 'NOT_CHECKED', note: '' }, liquiditySession: { score: 50, status: 'NOT_CHECKED', note: '' } };
const load = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };

export default function Dashboard() {
  const [active, setActive] = useState('chat');
  const [symbol, setSymbol] = useState('XAUUSD');
  const [timeframe, setTimeframe] = useState('1H');
  const [direction, setDirection] = useState('LONG');
  const [equity, setEquity] = useState(() => load('fq-equity', 100000));
  const [startingBalance, setStartingBalance] = useState(() => load('fq-starting', 100000));
  const [dailyPnLPct, setDailyPnLPct] = useState(() => load('fq-daily-pnl', 0));
  const [evidence, setEvidence] = useState(() => load('fq-evidence', initialEvidence));
  const [stopDistance, setStopDistance] = useState(50);
  const [pipValuePerLot, setPipValuePerLot] = useState(10);
  const [rrInput, setRrInput] = useState(2);
  const [probabilityInput, setProbabilityInput] = useState(0.6);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);
  const [scanResults, setScanResults] = useState([]);
  const [scanning, setScanning] = useState(false);
  const [chatInput, setChatInput] = useState('');
  const [messages, setMessages] = useState([{ role: 'assistant', agent: 'Rhea', text: 'Welcome to your research room. I coordinate the market, risk, and execution specialists. Ask me to analyze a market, scan the watchlist, or inspect a strategy.' }]);
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
        fetchCandles(marketSymbol, timeframe, 300), fetchQuote(marketSymbol), fetchCrossMarketQuotes(crossSymbols).catch(() => []),
        fetch('/api/context?action=calendar').then(r => r.json()).catch(() => ({ configured: false, events: [] })), fetch('/api/context?action=news').then(r => r.json()).catch(() => ({ configured: false, news: [] })),
      ]);
      const ind = computeIndicators(candles);
      if (ind.insufficientData) throw new Error(`Only ${ind.candleCount} candles returned. Need 210+ for EMA200.`);
      const regime = classifyRegime(ind);
      const auto = deriveAutoSubscores(ind, regime, direction);
      const manualScores = Object.fromEntries(Object.entries(evidence).map(([key, value]) => [key, value.score]));
      const subscores = { ...auto, ...manualScores, riskReward: scoreRiskReward(rrInput) };
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
      const filter = applyTradeFilter({ setupScore, probability: probabilityInput, riskReward: rrInput, dataQuality, verified, regimeSupportsSetup, contradictionReasons, dailyPnLPct: dailyPnLPct / 100, planComplete: plan.stopDistance > 0 && plan.target1 > 0 && pipValuePerLot > 0 });
      const { tier, risk } = riskTierFor(setupScore);
      const position = calculatePositionSize({ equity, riskPct: risk, stopDistancePips: stopDistance, pipValuePerLot });
      const next = { candles, fetchedAt, source, quote, ind, regime, setupScore, subscores, breakdown: scoreBreakdown(subscores), filter, tier, risk, position, narrative: null, plan, expectancy: expectancy(probabilityInput, rrInput), dataQuality, crossQuotes, calendar, news, backtest: backtestTrendSetups(candles), competition: classifyCompetitionState({ growthPct }) };
      setResult(next);
      setMessages(prev => [...prev, { role: 'assistant', agent: 'Rhea', text: `The research team finished the deterministic pass on ${symbol}. Decision: ${filter.decision.replaceAll('_', ' ')}. I’ve attached the chart, evidence matrix, and risk plan below.` }]);
      fetch('/api/narrative', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ computed: { symbol, timeframe, regime, setupScore, decision: filter.decision, reasons: filter.reasons, probability: probabilityInput, riskReward: rrInput, indicators: ind, plan, direction, riskTier: tier, dataQuality }, macroContext: evidence.macro.note, crossMarketContext: evidence.crossMarket.note }) }).then(r => r.json()).then(data => { if (data.narrative) setResult(prev => prev ? { ...prev, narrative: data.narrative } : prev); }).catch(() => {});
    } catch (e) { setError(String(e.message || e)); setMessages(prev => [...prev, { role: 'assistant', agent: 'Rhea', text: `I couldn’t complete the pass: ${String(e.message || e)}. No decision was produced.` }]); }
    finally { setLoading(false); }
  }

  async function scanShortlist() {
    setScanning(true); setError(null);
    try {
      const rows = [];
      for (const item of ['XAUUSD', 'EURUSD', 'USDJPY']) {
        const { candles } = await fetchCandles(SYMBOLS[item], timeframe, 220); const ind = computeIndicators(candles); if (ind.insufficientData) continue;
        const regime = classifyRegime(ind); const base = { crossMarket: 50, macro: 50, entryQuality: 50, liquiditySession: 50, riskReward: scoreRiskReward(2) }; const longScore = computeSetupScore({ ...deriveAutoSubscores(ind, regime, 'LONG'), ...base }); const shortScore = computeSetupScore({ ...deriveAutoSubscores(ind, regime, 'SHORT'), ...base }); const [bias, score] = longScore >= shortScore ? ['LONG', longScore] : ['SHORT', shortScore]; rows.push({ symbol: item, bias, score, regime });
      }
      setScanResults(rows.sort((a, b) => b.score - a.score)); setMessages(prev => [...prev, { role: 'assistant', agent: 'Atlas', text: `Shortlist scan complete. ${rows.length} markets ranked on technical evidence only. Context and risk still require review.` }]);
    } catch (e) { setError(String(e.message || e)); } finally { setScanning(false); }
  }

  async function sendChat(e) {
    e?.preventDefault(); const text = chatInput.trim(); if (!text || loading || scanning) return; setMessages(prev => [...prev, { role: 'user', text }]); setChatInput('');
    const lower = text.toLowerCase(); const found = Object.keys(SYMBOLS).find(key => lower.includes(key.toLowerCase())); if (found) setSymbol(found);
    if (/scan|watchlist|shortlist/.test(lower)) { setMessages(prev => [...prev, { role: 'assistant', agent: 'Rhea', text: 'I’m delegating this to Atlas for a bounded technical scan.' }]); await scanShortlist(); return; }
    if (/analy|check|research|market|trade|setup|look/.test(lower)) { if (found) setSymbol(found); setMessages(prev => [...prev, { role: 'assistant', agent: 'Rhea', text: `Delegating ${found || symbol} to Atlas, Noor, and Sable. They’ll share one research context.` }]); await runAnalysis(); return; }
    setMessages(prev => [...prev, { role: 'assistant', agent: 'Rhea', text: 'Try “Analyze XAUUSD”, “Research EURUSD”, or “Scan the watchlist”. You can also use the context drawer to adjust risk and evidence.' }]);
  }

  const updateEvidence = (key, patch) => setEvidence(prev => ({ ...prev, [key]: { ...prev[key], ...patch } }));
  const viewTitle = useMemo(() => ({ office: 'Office', markets: 'Markets', chat: 'Research room', coding: 'Coding', strategies: 'Strategies', portfolio: 'Portfolio' }[active] || 'Research room'), [active]);
  const dataAgeText = result ? (result.dataQuality.current ? `${Math.round(result.dataQuality.ageSeconds)}s old` : 'STALE') : 'Awaiting data';

  return <main className="workspace"><aside className="sidebar"><div className="brand"><div className="brand-mark">M</div><div><b>MyQuant</b><span>Financial intelligence</span></div></div><div className="workspace-switcher"><span className="workspace-avatar">Q</span><div><b>Quant research</b><span>Personal workspace</span></div><span className="chevron">⌄</span></div><nav>{NAV.map(([id, icon, label]) => <button key={id} className={`nav-item ${active === id ? 'active' : ''}`} onClick={() => setActive(id)}><i>{icon}</i>{label}{id === 'chat' && <em>1</em>}</button>)}</nav><div className="sidebar-bottom"><button className="nav-item" onClick={() => setActive('settings')}><i>⚙</i>Settings</button><div className="profile"><span className="profile-avatar">C</span><div><b>Chike</b><span>Free workspace</span></div><span>•••</span></div></div></aside><div className="mobile-top"><div className="brand"><div className="brand-mark">M</div><b>MyQuant</b></div><button onClick={() => setActive('settings')}>⚙</button></div><section className="main-column"><header className="topbar"><div><span className="eyebrow">{viewTitle}</span><h1>{active === 'chat' ? 'Trading research room' : viewTitle}</h1></div><div className="top-actions"><span className="live-dot" /> Twelve Data connected <button className="icon-btn">⌘ K</button></div></header>{active === 'chat' || active === 'office' ? <ChatView messages={messages} result={result} error={error} loading={loading} scanning={scanning} chatInput={chatInput} setChatInput={setChatInput} sendChat={sendChat} symbol={symbol} timeframe={timeframe} dataAgeText={dataAgeText} /> : <PlaceholderView active={active} onAnalyze={() => setActive('chat')} />}</section><aside className="right-rail"><div className="rail-header"><span>Research team</span><span className="online-label"><i /> 3 online</span></div><div className="team-list">{AGENTS.map(agent => <AgentCard key={agent.name} agent={agent} />)}</div><div className="rail-section"><div className="rail-title">Current context</div><ContextMini symbol={symbol} timeframe={timeframe} regime={result?.regime} dataAgeText={dataAgeText} /></div><div className="rail-section"><div className="rail-title">Risk guardrails</div><div className="guardrail"><span>Daily loss stop</span><b className={dailyPnLPct <= -2 ? 'danger' : ''}>{dailyPnLPct.toFixed(1)}% / -2.0%</b></div><div className="guardrail"><span>Account growth</span><b className="positive">+{growthPct.toFixed(2)}%</b></div></div></aside><nav className="mobile-nav">{NAV.slice(0, 5).map(([id, icon, label]) => <button key={id} className={active === id ? 'active' : ''} onClick={() => setActive(id)}><i>{icon}</i><span>{label === 'Research room' ? 'Chat' : label}</span></button>)}</nav></main>;
}

function ChatView({ messages, result, error, loading, scanning, chatInput, setChatInput, sendChat, symbol, timeframe, dataAgeText }) { return <div className="research-layout"><div className="thread-header"><div className="thread-title"><div className="avatar-stack"><span className="agent-avatar violet">R</span><span className="agent-avatar blue">A</span><span className="agent-avatar amber">N</span></div><div><b>Trading research team</b><span>4 agents · Shared context · {symbol} / {timeframe}</span></div></div><button className="ghost-btn">•••</button></div><div className="thread"><div className="thread-date">TODAY · {dataAgeText}</div>{messages.map((m, i) => <Message key={`${m.role}-${i}`} message={m} />)}{loading && <div className="typing"><span /><span /><span /> Research team is working…</div>}{scanning && <div className="typing"><span /><span /><span /> Atlas is scanning the shortlist…</div>}{result && <ResearchArtifact result={result} symbol={symbol} timeframe={timeframe} />}{error && <div className="error-card">{error}</div>}</div><form className="composer" onSubmit={sendChat}><button type="button" className="composer-tool">＋</button><input value={chatInput} onChange={e => setChatInput(e.target.value)} placeholder="Ask your research team anything…" disabled={loading || scanning} /><button type="button" className="composer-tool">⌁</button><button className="send-btn" disabled={!chatInput.trim() || loading || scanning}>↑</button></form><div className="prompt-row"><button onClick={() => setChatInput(`Analyze ${symbol}`)}>Analyze market</button><button onClick={() => setChatInput('Scan the watchlist')}>Scan watchlist</button><button onClick={() => setChatInput('Review the risk on this setup')}>Review risk</button></div><ContextDrawer result={result} symbol={symbol} timeframe={timeframe} /></div> }

function Message({ message }) { if (message.role === 'user') return <div className="message user-message"><div className="message-bubble">{message.text}</div><span className="user-mini">C</span></div>; return <div className="message"><span className={`agent-avatar ${message.agent === 'Atlas' ? 'blue' : 'violet'}`}>{(message.agent || 'R')[0]}</span><div className="message-body"><div className="message-meta"><b>{message.agent || 'Rhea'}</b><span>now</span></div><div className="message-text">{message.text}</div></div></div>; }
function AgentCard({ agent }) { return <div className="agent-card"><span className={`agent-avatar ${agent.color}`}>{agent.name[0]}</span><div><b>{agent.name}</b><span>{agent.role}</span></div><i className={`status ${agent.status}`} /></div>; }
function ContextMini({ symbol, timeframe, regime, dataAgeText }) { return <div className="context-mini"><div><span>Instrument</span><b>{symbol}</b></div><div><span>Timeframe</span><b>{timeframe}</b></div><div><span>Regime</span><b>{regime || 'Not analyzed'}</b></div><div><span>Data</span><b>{dataAgeText}</b></div></div>; }
function ContextDrawer({ result, symbol, timeframe }) { return <details className="context-card"><summary><span>⌘</span><div><b>Shared research context</b><small>{symbol} · {timeframe} · {result ? 'Analysis attached' : 'Ready for analysis'}</small></div><i>⌄</i></summary>{result && <div className="context-preview"><span className="chip">{result.regime}</span><span className="chip">Score {result.setupScore}</span><span className="chip">{result.filter.decision.replaceAll('_', ' ')}</span></div>}</details>; }
function ResearchArtifact({ result, symbol, timeframe }) { return <div className="artifact"><div className="artifact-head"><div><span className="artifact-kicker">COORDINATED RESEARCH REPORT</span><h3>{symbol} · {timeframe}</h3></div><span className={`decision-pill ${result.filter.decision.toLowerCase()}`}>{result.filter.decision.replaceAll('_', ' ')}</span></div><div className="artifact-summary"><div><span>Setup score</span><b>{result.setupScore}<small>/100</small></b></div><div><span>Regime</span><b>{result.regime}</b></div><div><span>R:R</span><b>{result.plan.rr.toFixed(2)}</b></div><div><span>Data age</span><b>{Math.round(result.dataQuality.ageSeconds)}s</b></div></div><div className="artifact-chart"><LiveChart candles={result.candles} indicators={result.ind} plan={result.plan} height={300} /></div><div className="artifact-grid"><div><span>Trade plan</span><p>Entry {result.plan.entry.toFixed(2)} · Stop {result.plan.stop.toFixed(2)} · Target {result.plan.target1.toFixed(2)}</p></div><div><span>Evidence</span><p>{result.filter.reasons.length ? result.filter.reasons[0] : 'All required gates passed.'}</p></div></div><details className="artifact-details"><summary>Open full audit and specialist notes</summary><pre>{JSON.stringify({ score: result.breakdown, dataQuality: result.dataQuality, backtest: result.backtest, crossQuotes: result.crossQuotes }, null, 2)}</pre></details></div>; }
function PlaceholderView({ active, onAnalyze }) { return <div className="placeholder"><div className="placeholder-icon">{active === 'markets' ? '◈' : active === 'strategies' ? '⌁' : active === 'portfolio' ? '▥' : '</>'}</div><h2>{active[0].toUpperCase() + active.slice(1)} workspace</h2><p>This workspace is scaffolded for the next research surface. Your shared team context and quant engine are ready in Chat.</p><button onClick={onAnalyze}>Open research room</button></div>; }
function crossMarketSymbols(symbol) { const map = { XAUUSD: ['XAG/USD', 'USD/JPY', 'EUR/USD'], NAS100: ['DJI', 'XAU/USD', 'USD/JPY'], US30: ['NDX', 'XAU/USD', 'USD/JPY'], GER30: ['NDX', 'EUR/USD', 'XAU/USD'], EURUSD: ['USD/JPY', 'GBP/USD', 'XAU/USD'], GBPUSD: ['EUR/USD', 'USD/JPY', 'XAU/USD'], USDJPY: ['EUR/USD', 'XAU/USD', 'NDX'], AUDUSD: ['XAU/USD', 'USD/CAD', 'NDX'], USDCAD: ['USD/JPY', 'XAU/USD', 'AUD/USD'], XAGUSD: ['XAU/USD', 'USD/JPY', 'EUR/USD'] }; return map[symbol] || ['EUR/USD', 'USD/JPY']; }

function AccountPanel({ equity, setEquity, startingBalance, setStartingBalance, dailyPnLPct, setDailyPnLPct }) { return <div className="settings-panel"><label>Starting balance<input type="number" value={startingBalance} onChange={e => setStartingBalance(Number(e.target.value))} /></label><label>Current equity<input type="number" value={equity} onChange={e => setEquity(Number(e.target.value))} /></label><label>Daily P&amp;L<input type="number" value={dailyPnLPct} onChange={e => setDailyPnLPct(Number(e.target.value))} /></label></div>; }
