import { useEffect, useRef } from 'react';
import { createChart, ColorType, LineSeries } from 'lightweight-charts';

export default function LiveChart({ candles, indicators, plan, height = 420 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);
  const overlaysRef = useRef([]);

  useEffect(() => {
    if (!containerRef.current) return;

    const chart = createChart(containerRef.current, {
      height,
      layout: {
        background: { type: ColorType.Solid, color: '#080C14' },
        textColor: '#8A93A6',
        fontFamily: "'Plus Jakarta Sans', sans-serif",
      },
      grid: {
        vertLines: { color: '#131A28' },
        horzLines: { color: '#131A28' },
      },
      timeScale: { borderColor: '#1E2636', timeVisible: true },
      rightPriceScale: { borderColor: '#1E2636' },
      crosshair: { mode: 0 },
    });

    const series = chart.addCandlestickSeries({
      upColor: '#2563EB',
      downColor: '#F0A500',
      borderVisible: false,
      wickUpColor: '#2563EB',
      wickDownColor: '#F0A500',
    });

    chartRef.current = chart;
    seriesRef.current = series;

    const handleResize = () => {
      chart.applyOptions({ width: containerRef.current.clientWidth });
    };
    handleResize();
    window.addEventListener('resize', handleResize);

    return () => {
      window.removeEventListener('resize', handleResize);
      chart.remove();
    };
  }, [height]);

  useEffect(() => {
    if (!seriesRef.current || !candles?.length) return;
    const formatted = candles.map(c => ({
      time: Math.floor(new Date(c.time).getTime() / 1000),
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));
    seriesRef.current.setData(formatted);
    overlaysRef.current.forEach(s => chartRef.current.removeSeries(s));
    overlaysRef.current = [];
    const addLine = (value, color, title) => {
      if (!Number.isFinite(value)) return;
      const line = chartRef.current.addSeries(LineSeries, { color, lineWidth: 1, lineStyle: 2, title, priceLineVisible: true, lastValueVisible: true });
      line.setData(formatted.map(c => ({ time: c.time, value })));
      overlaysRef.current.push(line);
    };
    addLine(indicators?.ema20, '#60A5FA', 'EMA20');
    addLine(indicators?.ema50, '#A78BFA', 'EMA50');
    addLine(indicators?.ema200, '#F472B6', 'EMA200');
    addLine(indicators?.vwap, '#34D399', 'VWAP');
    addLine(plan?.entry, '#F8FAFC', 'ENTRY');
    addLine(plan?.stop, '#EF4444', 'STOP');
    addLine(plan?.target1, '#22C55E', 'T1');
    addLine(plan?.target2, '#16A34A', 'T2');
    chartRef.current.timeScale().fitContent();
  }, [candles, indicators, plan]);

  return <div><div className="flex flex-wrap gap-3 text-[10px] text-[#8A93A6] py-2"><span className="text-blue-300">EMA20</span><span className="text-violet-300">EMA50</span><span className="text-pink-300">EMA200</span><span className="text-emerald-300">VWAP</span><span className="text-white">ENTRY</span><span className="text-red-400">STOP</span><span className="text-green-400">TARGETS</span></div><div ref={containerRef} className="w-full rounded-lg overflow-hidden border border-[#1E2636]" /></div>;
}
