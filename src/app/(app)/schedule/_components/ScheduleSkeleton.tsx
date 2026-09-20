import { Skeleton } from "@/components/Skeleton";

export function ScheduleSkeleton() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Skeleton className="h-6 w-32" />
      <Skeleton className="mt-2 h-4 w-56" />

      <div className="mt-8 flex flex-col gap-6 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-40" />
          <Skeleton className="h-10 w-20" />
        </div>
        <div className="flex gap-2">
          <Skeleton className="h-9 w-32" />
          <Skeleton className="h-9 w-36" />
        </div>
      </div>

      <div className="mt-8 rounded-lg border border-border-subtle bg-surface p-5 shadow-sm">
        <Skeleton className="h-5 w-32" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
          <Skeleton className="h-10" />
        </div>
        <Skeleton className="mt-4 h-16" />
        <Skeleton className="mt-4 h-9 w-32" />
      </div>

      <div className="mt-8 grid gap-3" style={{ gridTemplateColumns: "repeat(7, 1fr)" }}>
        {Array.from({ length: 7 }).map((_, i) => (
          <div
            key={i}
            className="flex flex-col gap-2 rounded-lg border border-border-subtle bg-white p-3"
          >
            <Skeleton className="h-4 w-12" />
            <Skeleton className="h-14" />
          </div>
        ))}
      </div>
    </main>
  );
}
