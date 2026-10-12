import { Skeleton } from "@/components/ui/skeleton";

export default function Loading() {
  return (
    <>
      <div className="border-b bg-card">
        <div className="mx-auto max-w-7xl space-y-2 px-4 py-5 md:px-8">
          <Skeleton className="h-3 w-24" />
          <Skeleton className="h-6 w-96 max-w-full" />
          <Skeleton className="h-5 w-40" />
        </div>
      </div>
      <main className="mx-auto grid w-full max-w-7xl gap-6 px-4 py-6 md:px-8 lg:grid-cols-[1fr_320px]">
        <div className="space-y-6">
          <Skeleton className="h-32 rounded-xl" />
          <div className="grid gap-6 md:grid-cols-2">
            <Skeleton className="h-36 rounded-xl" />
            <Skeleton className="h-36 rounded-xl" />
          </div>
          <Skeleton className="h-48 rounded-xl" />
        </div>
        <Skeleton className="h-72 rounded-xl" />
      </main>
    </>
  );
}
