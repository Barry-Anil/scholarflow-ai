"use client";

import {
  Activity,
  BookOpen,
  Files,
  GraduationCap,
  LayoutDashboard,
  Settings2,
  ShieldCheck,
} from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

export const workspaceNavigation = [
  { label: "Overview", href: "/dashboard", icon: LayoutDashboard },
  { label: "Courses", href: "/dashboard/courses", icon: BookOpen },
  { label: "Knowledge base", href: "/dashboard/knowledge", icon: Files },
  { label: "Study Tutor", href: "/study-tutor", icon: GraduationCap },
  { label: "Agent activity", href: "/dashboard/activity", icon: Activity },
  { label: "Review center", href: "/dashboard/reviews", icon: ShieldCheck },
  { label: "Settings", href: "/dashboard/settings", icon: Settings2 },
] as const;

export function WorkspaceNav({ mobile = false }: { mobile?: boolean }) {
  const pathname = usePathname();

  return (
    <nav
      className={
        mobile ? "flex gap-1 overflow-x-auto px-4 py-2" : "mt-9 space-y-1"
      }
      aria-label="Workspace navigation"
    >
      {workspaceNavigation.map(({ label, href, icon: Icon }) => {
        const active =
          href === "/dashboard"
            ? pathname === href
            : pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={href}
            href={href}
            className={`flex shrink-0 items-center gap-2.5 rounded-xl px-3 py-2.5 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-teal-500/30 ${
              active
                ? "bg-slate-950 text-white"
                : "text-slate-500 hover:bg-slate-100 hover:text-slate-900"
            }`}
            aria-current={active ? "page" : undefined}
          >
            <Icon className="size-4.5" aria-hidden="true" />
            {label}
          </Link>
        );
      })}
    </nav>
  );
}
