import React, { useEffect, useRef, useState } from 'react';
import mermaid from 'mermaid';
import { Copy, Check, ZoomIn, RefreshCw } from 'lucide-react';

interface MermaidDiagramProps {
  chart: string;
  id?: string;
}

mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  themeVariables: {
    darkMode: true,
    background: '#0a0a0a',
    primaryColor: '#262626',
    primaryTextColor: '#f5f5f5',
    primaryBorderColor: '#404040',
    lineColor: '#737373',
    secondaryColor: '#171717',
    tertiaryColor: '#262626',
    fontFamily: 'JetBrains Mono, monospace',
    fontSize: '13px',
  },
  securityLevel: 'loose',
});

export const MermaidDiagram: React.FC<MermaidDiagramProps> = ({ chart, id }) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [svgContent, setSvgContent] = useState<string>('');
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [isZoomed, setIsZoomed] = useState(false);

  const uniqueId = useRef(`mermaid-${id || Math.random().toString(36).substring(2, 9)}`);

  useEffect(() => {
    let isMounted = true;
    const renderDiagram = async () => {
      try {
        setError(null);
        const { svg } = await mermaid.render(uniqueId.current, chart.trim());
        if (isMounted) {
          setSvgContent(svg);
        }
      } catch (err: any) {
        if (isMounted) {
          setError(err?.message || 'Failed to render Mermaid diagram');
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
    setTimeout(() => setCopied(false), 2000);
  };

  if (error) {
    return (
      <div className="my-3 rounded border border-red-900/50 bg-red-950/20 p-3 text-xs font-mono text-red-400">
        <div className="flex items-center justify-between mb-2">
          <span className="font-semibold uppercase tracking-wider">Mermaid Syntax Error</span>
          <button
            onClick={handleCopySource}
            className="text-neutral-400 hover:text-neutral-200 transition-colors"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>
        <pre className="text-neutral-300 overflow-x-auto p-2 bg-neutral-900/80 rounded">{chart}</pre>
        <div className="mt-2 text-neutral-400 text-[11px]">{error}</div>
      </div>
    );
  }

  return (
    <div className="my-3 rounded-md border border-neutral-800 bg-neutral-900/50 overflow-hidden">
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-neutral-800 bg-neutral-900 text-neutral-400 text-xs">
        <span className="font-mono text-[11px] tracking-wide text-neutral-300 uppercase">Diagram</span>
        <div className="flex items-center gap-2">
          <button
            onClick={handleCopySource}
            className="flex items-center gap-1 hover:text-neutral-200 transition-colors p-1 rounded"
            title="Copy Mermaid source"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
            <span className="text-[10px]">{copied ? 'Copied' : 'Source'}</span>
          </button>
          <button
            onClick={() => setIsZoomed(!isZoomed)}
            className="flex items-center gap-1 hover:text-neutral-200 transition-colors p-1 rounded"
            title={isZoomed ? 'Shrink diagram' : 'Expand diagram'}
          >
            <ZoomIn className="w-3.5 h-3.5" />
            <span className="text-[10px]">{isZoomed ? 'Reset' : 'Expand'}</span>
          </button>
        </div>
      </div>

      <div
        ref={containerRef}
        className={`p-4 flex items-center justify-center overflow-x-auto transition-all ${
          isZoomed ? 'min-h-[450px] scale-105' : 'min-h-[160px]'
        }`}
        dangerouslySetInnerHTML={{ __html: svgContent }}
      />
    </div>
  );
};
