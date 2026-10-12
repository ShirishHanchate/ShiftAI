"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bot, ClipboardList, LayoutDashboard, Mic, Sunrise } from "lucide-react";
import { cn } from "@/lib/utils";

const ICONS = { dashboard: LayoutDashboard, mic: Mic, briefing: Sunrise, agent: Bot, log: ClipboardList };

interface NavLinkProps {
  href: string;
  label: string;
  icon: keyof typeof ICONS;
  /** Render without reading the pathname (Suspense fallback). */
  static?: boolean;
}

export function NavLink(props: NavLinkProps) {
  return props.static ? <NavLinkView {...props} active={false} /> : <ActiveNavLink {...props} />;
}

function ActiveNavLink(props: NavLinkProps) {
  const pathname = usePathname();
  const { href } = props;
  const active =
    href === "/"
      ? pathname === "/" || pathname.startsWith("/incidents")
      : pathname === href || pathname.startsWith(`${href}/`);
  return <NavLinkView {...props} active={active} />;
}

function NavLinkView({ href, label, icon, active }: NavLinkProps & { active: boolean }) {
  const Icon = ICONS[icon];
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors",
        active
          ? "bg-sidebar-accent font-medium text-white"
          : "text-sidebar-foreground/75 hover:bg-sidebar-accent/60 hover:text-white",
      )}
    >
      <Icon className="size-4" />
      {label}
    </Link>
  );
}
