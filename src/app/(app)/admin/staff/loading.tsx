import { Skeleton } from "@/components/Skeleton";

export default function AdminStaffLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Skeleton className="h-6 w-16" />
      <Skeleton className="mt-2 h-4 w-72" />

      <div className="mt-8 flex flex-col gap-10">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="border-b pb-8 last:border-0">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="mt-1 h-3 w-56" />
            <div className="mt-4 grid gap-8 sm:grid-cols-2">
              <Skeleton className="h-20" />
              <Skeleton className="h-20" />
            </div>
          </div>
        ))}
      </div>
    </main>
  );
}
