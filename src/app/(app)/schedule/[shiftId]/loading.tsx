import { Skeleton } from "@/components/Skeleton";

export default function ShiftDetailLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Skeleton className="h-3 w-24" />
      <Skeleton className="mt-2 h-6 w-64" />
      <Skeleton className="mt-2 h-3 w-40" />

      <div className="mt-6 grid grid-cols-2 gap-x-6 gap-y-4 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i}>
            <Skeleton className="h-3 w-20" />
            <Skeleton className="mt-1 h-4 w-16" />
          </div>
        ))}
      </div>

      <div className="mt-10 flex flex-col gap-10">
        <section>
          <Skeleton className="h-5 w-20" />
          <Skeleton className="mt-2 h-10" />
        </section>
        <section>
          <Skeleton className="h-5 w-24" />
          <div className="mt-4 flex flex-col gap-2">
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
            <Skeleton className="h-10" />
          </div>
        </section>
      </div>
    </main>
  );
}
