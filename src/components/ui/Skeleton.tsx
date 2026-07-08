// Shimmer placeholder block (CSS gradient animation defined in globals.css as
// .rc-skeleton). Used by the loading states in later phases.
export default function Skeleton({ className = "" }: { className?: string }) {
  return <div aria-hidden className={`rc-skeleton rounded-sm ${className}`} />;
}
