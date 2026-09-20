import { Skeleton } from "@/components/Skeleton";

export default function AvailabilityLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Skeleton className="h-6 w-40" />
      <Skeleton className="mt-2 h-4 w-96" />

      <div className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <Skeleton className="h-5 w-36" />
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {Array.from({ length: 7 }).map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <Skeleton className="h-5 w-24" />
        <Skeleton className="mt-4 h-10" />
      </div>
    </main>
  );
}
