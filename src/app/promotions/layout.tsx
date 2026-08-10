// Promotions is its own top-level feature. White workspace + centered content
// column, mirroring the planner/dashboard shells so the app feels like one
// product.
export default function PromotionsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="rc-content-panel flex-1 overflow-y-auto">
      <div className="max-w-6xl mx-auto px-8 py-8">{children}</div>
    </div>
  );
}
