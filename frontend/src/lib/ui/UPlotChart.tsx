import { useEffect, useRef } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';

interface Props {
  data: uPlot.AlignedData;
  options: Omit<uPlot.Options, 'width' | 'height'> & { height: number };
}

/** Thin React lifecycle wrapper around uPlot (canvas-based — cheap even with 100+ instances). */
export function UPlotChart({ data, options }: Props): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const plotRef = useRef<uPlot | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;
    const width = containerRef.current.clientWidth || 300;
    plotRef.current = new uPlot({ ...options, width, height: options.height }, data, containerRef.current);

    const resize = (): void => {
      if (containerRef.current && plotRef.current) {
        plotRef.current.setSize({ width: containerRef.current.clientWidth, height: options.height });
      }
    };
    const observer = new ResizeObserver(resize);
    observer.observe(containerRef.current);

    return () => {
      observer.disconnect();
      plotRef.current?.destroy();
      plotRef.current = null;
    };
    // Options identity (series/scales config) intentionally not in deps — see data-only effect below.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [options.height, options.series?.length]);

  useEffect(() => {
    plotRef.current?.setData(data);
  }, [data]);

  return <div ref={containerRef} />;
}
