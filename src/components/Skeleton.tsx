export function Skeleton({ className = "" }: { readonly className?: string }) {
  return <div aria-hidden className={`animate-pulse rounded bg-gray-200 ${className}`} />;
}
