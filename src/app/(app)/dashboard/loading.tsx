import { Skeleton } from "@/components/Skeleton";

export default function DashboardLoading() {
  return (
    <main className="mx-auto max-w-6xl px-6 py-12">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-16" />

      <div className="mt-10">
        <Skeleton className="h-4 w-40" />
        <div className="mt-3 grid grid-cols-3 gap-4">
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
          <Skeleton className="h-20" />
        </div>
      </div>
    </main>
  );
}
