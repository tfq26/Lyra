import React, { useEffect, useRef, useState } from 'react';
import { Copy, Check, ZoomIn } from 'lucide-react';

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart, id }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  const uniqueId = useRef(`mermaid-${id || Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        setError(null);
        setIsLoading(true);
        const { default: mermaid } = await import('mermaid');
        mermaid.initialize({
          startOnLoad: false,
          theme: 'dark',
          themeVariables: {
            darkMode: true,
            background: '#09090b',
            primaryColor: '#18181b',
            primaryTextColor: '#f4f4f5',
            primaryBorderColor: '#3f3f46',
            lineColor: '#71717a',
            secondaryColor: '#18181b',
            tertiaryColor: '#18181b',
            fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
            fontSize: '12px',
          },
          securityLevel: 'strict',
        });
        const { svg } = await mermaid.render(uniqueId.current, chart.trim());
        if (isMounted) {
          setSvgContent(svg);
          setIsLoading(false);
        }
      } catch (err: any) {
        if (isMounted) {
          setIsLoading(false);
          setError(err?.message || 'Failed to render diagram');
        }
      }
    };

    renderDiagram();
    return () => {
      isMounted = false;
    };
  }, [chart]);

  const handleCopySource = () => {
    navigator.clipboard.writeText(chart);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  if (error) {
    return (
      <div className="my-2 rounded-md border border-neutral-800 bg-neutral-900/40 p-3 text-xs text-neutral-400">
        <div className="flex items-center justify-between mb-2">
          <span className="text-[11px] text-neutral-500">Diagram Source</span>
          <button
            onClick={handleCopySource}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <pre className="text-neutral-300 overflow-x-auto p-2 bg-neutral-950 rounded text-xs">{chart}</pre>
      </div>
    );
  }

  if (isLoading) {
    return <div className="my-2 min-h-[140px] rounded-md border border-neutral-800/80 bg-[#09090b] p-4 flex items-center justify-center text-xs text-neutral-500">Loading diagram renderer…</div>;
  }

  return (
    <div className="my-2 rounded-md border border-neutral-800/80 bg-[#09090b] overflow-hidden text-xs">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800/60 bg-neutral-900/40 text-neutral-500">
        <span className="text-[11px]">Diagram</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySource}
            className="hover:text-neutral-300 transition-colors p-1 rounded"
            title="Copy source"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-neutral-300" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
          <button
            onClick={() => setIsZoomed(!isZoomed)}
            className="hover:text-neutral-300 transition-colors p-1 rounded"
            title={isZoomed ? 'Shrink' : 'Expand'}
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`p-4 flex items-center justify-center overflow-x-auto transition-all ${
          isZoomed ? 'min-h-[400px]' : 'min-h-[140px]'
        }`}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
};
