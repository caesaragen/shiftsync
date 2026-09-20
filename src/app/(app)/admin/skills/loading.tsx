import { Skeleton } from "@/components/Skeleton";

export default function AdminSkillsLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Skeleton className="h-6 w-24" />
      <Skeleton className="mt-2 h-4 w-72" />

      <div className="mt-8 flex flex-col gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <Skeleton key={i} className="h-9" />
        ))}
      </div>

      <Skeleton className="mt-12 h-5 w-28" />
      <div className="mt-4 flex max-w-sm flex-col gap-4">
        <Skeleton className="h-10" />
        <Skeleton className="h-9 w-28" />
      </div>
    </main>
  );
}
