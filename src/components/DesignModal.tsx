"use client";
import { useRef, useState } from "react";

interface Props {
  /** Current design HTML. Empty string while the very first generation is in progress. */
  html: string;
  isGenerating: boolean;
  onRegenerate: () => void;
  onClose: () => void;
}

export default function DesignModal({ html, isGenerating, onRegenerate, onClose }: Props) {
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const [iframeHeight, setIframeHeight] = useState(400);
  const [downloading, setDownloading] = useState(false);

  const handleIframeLoad = () => {
    const doc = iframeRef.current?.contentDocument;
    if (doc) {
      const h = doc.documentElement?.scrollHeight || doc.body?.scrollHeight || 400;
      setIframeHeight(h);
    }
  };

  const handleDownload = async () => {
    const iframe = iframeRef.current;
    if (!iframe?.contentDocument?.body) return;
    setDownloading(true);
    try {
      const { default: html2canvas } = await import("html2canvas");
      const canvas = await html2canvas(iframe.contentDocument.body, {
        scale: 2,
        useCORS: true,
        allowTaint: true,
        width: 600,
        windowWidth: 600,
        scrollX: 0,
        scrollY: 0,
      });
      const a = document.createElement("a");
      a.download = "header-mockup.png";
      a.href = canvas.toDataURL("image/png");
      a.click();
    } catch (err) {
      console.error("PNG export failed:", err);
    } finally {
      setDownloading(false);
    }
  };

  // Three display states:
  // 1. First generation in progress: html="", isGenerating=true → full loading screen
  // 2. Regeneration in progress: html="...", isGenerating=true → iframe + loading overlay
  // 3. Idle: html="...", isGenerating=false → iframe only
  const isFirstGeneration = !html && isGenerating;
  const isRegenerating = !!html && isGenerating;

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh] w-full"
        style={{ maxWidth: 660 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <span className="font-mono text-xs text-slate-500 uppercase tracking-wide">Header Mockup</span>
          <div className="flex items-center gap-2">
            {html && (
              <button
                onClick={handleDownload}
                disabled={isGenerating || downloading}
                className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                {downloading ? "Exporting…" : "Download PNG"}
              </button>
            )}
            <button
              onClick={onRegenerate}
              disabled={isGenerating}
              className="text-xs bg-slate-900 text-white px-3 py-1.5 rounded-md hover:bg-slate-700 transition-colors disabled:opacity-40"
            >
              {isGenerating ? "Generating…" : "↺ Regenerate"}
            </button>
            <button
              onClick={onClose}
              className="text-slate-400 hover:text-slate-700 px-2 py-1.5 transition-colors text-sm leading-none"
            >
              ✕
            </button>
          </div>
        </div>

        {/* Preview */}
        <div className="flex-1 overflow-auto p-6 flex justify-center bg-slate-100">
          {isFirstGeneration && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-600 animate-spin" />
              <span className="font-mono text-xs text-slate-400 uppercase tracking-wide">Generating design…</span>
            </div>
          )}

          {!isFirstGeneration && html && (
            <div className="relative shadow-lg" style={{ width: 600 }}>
              <iframe
                ref={iframeRef}
                srcDoc={html}
                style={{ width: 600, height: iframeHeight, border: "none", display: "block" }}
                onLoad={handleIframeLoad}
                sandbox="allow-same-origin"
              />
              {isRegenerating && (
                <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
                  <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-600 animate-spin" />
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
