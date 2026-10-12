import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="border-b bg-card">
        <div className="mx-auto max-w-7xl space-y-2 px-4 py-5 md:px-8">
          <Skeleton className="h-3 w-20" />
          <Skeleton className="h-6 w-56" />
          <Skeleton className="h-4 w-96 max-w-full" />
        </div>
      </div>
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 md:px-8 lg:grid-cols-[1fr_340px]">
        <Skeleton className="h-80 rounded-xl" />
        <Skeleton className="h-80 rounded-xl" />
      </main>
    </>
  );
}
