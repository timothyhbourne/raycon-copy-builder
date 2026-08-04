"use client";

interface Props {
  /** Base64 data URI of the generated PNG. Empty string while first generation is in progress. */
  image: string;
  isGenerating: boolean;
  onRegenerate: () => void;
  onClose: () => void;
}

export default function DesignModal({ image, isGenerating, onRegenerate, onClose }: Props) {
  const isFirstGeneration = !image && isGenerating;
  const isRegenerating = !!image && isGenerating;

  const handleDownload = () => {
    const a = document.createElement("a");
    a.href = image;
    a.download = "header-mockup.png";
    a.click();
  };

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 p-6"
      onClick={onClose}
    >
      <div
        className="bg-white rounded-xl shadow-2xl flex flex-col max-h-[90vh] w-full"
        style={{ maxWidth: 700 }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Toolbar */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 shrink-0">
          <span className="t-label text-slate-500">Header Mockup</span>
          <div className="flex items-center gap-2">
            {image && (
              <button
                onClick={handleDownload}
                disabled={isGenerating}
                className="text-xs text-slate-600 border border-slate-200 px-3 py-1.5 rounded-md hover:bg-slate-50 transition-colors disabled:opacity-40"
              >
                Download PNG
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
        <div className="flex-1 overflow-auto p-6 flex justify-center items-start bg-slate-100">
          {isFirstGeneration && (
            <div className="flex flex-col items-center justify-center py-20 gap-4">
              <div className="w-8 h-8 rounded-full border-2 border-slate-200 border-t-slate-600 animate-spin" />
              <span className="t-label">Generating design…</span>
            </div>
          )}

          {!isFirstGeneration && image && (
            <div className="relative shadow-lg">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={image}
                alt="Header mockup"
                style={{ width: "100%", maxWidth: 660, display: "block" }}
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
