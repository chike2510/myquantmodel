import { useEffect, useRef } from 'react';
import { createChart, ColorType } from 'lightweight-charts';

export default function LiveChart({ candles, height = 420 }) {
  const containerRef = useRef(null);
  const chartRef = useRef(null);
  const seriesRef = useRef(null);

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
    chartRef.current.timeScale().fitContent();
  }, [candles]);

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden border border-[#1E2636]" />;
}
