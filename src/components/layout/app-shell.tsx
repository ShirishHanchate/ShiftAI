import Link from "next/link";
import { Suspense } from "react";
import { Activity, Bot, ClipboardList, LayoutDashboard, Mic, RadioTower, Sunrise } from "lucide-react";
import { NavLink } from "./nav-link";

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen w-full">
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 flex-col border-r border-sidebar-border bg-sidebar text-sidebar-foreground md:flex">
        <Link href="/" className="flex h-14 items-center gap-2.5 border-b border-sidebar-border px-5">
          <span className="flex size-7 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
            <RadioTower className="size-4" />
          </span>
          <span className="text-sm font-semibold tracking-tight text-white">ShiftSync AI</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-0.5 p-3">
          <p className="px-2 pt-2 pb-1.5 text-[10px] font-semibold tracking-widest text-sidebar-foreground/50 uppercase">
            Operations
          </p>
          {/* usePathname() is request data, so it streams in behind a static fallback. */}
          <Suspense fallback={<NavLinks static />}>
            <NavLinks />
          </Suspense>
        </nav>
        <div className="m-3 rounded-lg bg-sidebar-accent/60 p-3 text-xs text-sidebar-foreground/70">
          <div className="mb-1 flex items-center gap-1.5 font-medium text-sidebar-foreground">
            <Activity className="size-3.5" /> Demo environment
          </div>
          All incidents, services and people are fictional.
        </div>
      </aside>
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex h-14 items-center gap-2 border-b bg-sidebar px-4 text-white md:hidden">
          <RadioTower className="size-4" />
          <span className="text-sm font-semibold">ShiftSync AI</span>
          <nav className="ml-auto flex gap-1">
            <Link href="/" className="rounded-md p-2 hover:bg-sidebar-accent" aria-label="Incidents">
              <LayoutDashboard className="size-4" />
            </Link>
            <Link href="/handover" className="rounded-md p-2 hover:bg-sidebar-accent" aria-label="Voice handover">
              <Mic className="size-4" />
            </Link>
            <Link href="/briefing" className="rounded-md p-2 hover:bg-sidebar-accent" aria-label="Incoming shift briefing">
              <Sunrise className="size-4" />
            </Link>
            <Link href="/assistant" className="rounded-md p-2 hover:bg-sidebar-accent" aria-label="Ask ShiftSync">
              <Bot className="size-4" />
            </Link>
            <Link href="/handovers" className="rounded-md p-2 hover:bg-sidebar-accent" aria-label="Handover log">
              <ClipboardList className="size-4" />
            </Link>
          </nav>
        </header>
        {children}
      </div>
    </div>
  );
}

export function PageHeader({
  title,
  description,
  actions,
  breadcrumb,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  actions?: React.ReactNode;
  breadcrumb?: React.ReactNode;
}) {
  return (
    <div className="border-b bg-card">
      <div className="mx-auto flex w-full max-w-7xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-end sm:justify-between md:px-8">
        <div className="min-w-0">
          {breadcrumb && <div className="mb-1.5 text-xs text-muted-foreground">{breadcrumb}</div>}
          <h1 className="text-xl font-semibold tracking-tight">{title}</h1>
          {description && <p className="mt-1 text-sm text-muted-foreground">{description}</p>}
        </div>
        {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
      </div>
    </div>
  );
}

export function PageBody({ children }: { children: React.ReactNode }) {
  return <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 md:px-8">{children}</main>;
}

function NavLinks({ static: isStatic }: { static?: boolean }) {
  return (
    <>
      <NavLink href="/" label="Incidents" icon="dashboard" static={isStatic} />
      <NavLink href="/handover" label="Voice Handover" icon="mic" static={isStatic} />
      <NavLink href="/briefing" label="Incoming Shift" icon="briefing" static={isStatic} />
      <NavLink href="/assistant" label="Ask ShiftSync" icon="agent" static={isStatic} />
      <NavLink href="/handovers" label="Handover Log" icon="log" static={isStatic} />
    </>
  );
}
