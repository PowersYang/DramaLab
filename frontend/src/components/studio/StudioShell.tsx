"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { ReactNode } from "react";
import { CreditCard, FolderKanban, LayoutDashboard, Library, Settings2, Users2, Workflow } from "lucide-react";

import LumenXBranding from "@/components/layout/LumenXBranding";

interface StudioShellProps {
  children: ReactNode;
  title: string;
  description: string;
  actions?: ReactNode;
}

const NAV_ITEMS = [
  { href: "/studio", label: "总览", icon: LayoutDashboard },
  { href: "/studio/projects", label: "项目中心", icon: FolderKanban },
  { href: "/studio/library", label: "资产库", icon: Library },
  { href: "/studio/tasks", label: "任务中心", icon: Workflow },
  { href: "/studio/team", label: "团队", icon: Users2 },
  { href: "/studio/billing", label: "计费", icon: CreditCard },
  { href: "/studio/settings", label: "设置", icon: Settings2 },
];

export default function StudioShell({ children, title, description, actions }: StudioShellProps) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen bg-[#f4f5f7] text-slate-900">
      <aside className="hidden w-[278px] flex-col border-r border-slate-200 bg-[#f8f6f2] px-6 py-6 lg:flex">
        <Link href="/studio" className="block">
          <LumenXBranding size="sm" showSlogan={false} />
        </Link>

        <nav className="mt-4 space-y-2">
          {NAV_ITEMS.map((item) => {
            const isActive = pathname === item.href || (item.href !== "/studio" && pathname.startsWith(item.href));
            const Icon = item.icon;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`flex items-center gap-3 rounded-2xl px-4 py-3 text-sm font-semibold transition-colors ${
                  isActive
                    ? "bg-slate-950 text-white shadow-sm"
                    : "text-slate-600 hover:bg-white hover:text-slate-950"
                }`}
              >
                <Icon size={18} className={isActive ? "text-white" : "text-primary"} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>

      <div className="flex min-h-screen flex-1 flex-col">
        <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm">
          <div className="flex flex-col gap-5 px-6 py-5 lg:flex-row lg:items-center lg:justify-between lg:px-10">
            <div>
              <h1 className="text-3xl font-bold text-slate-950">{title}</h1>
            </div>

            <div className="flex items-center gap-3 self-start lg:self-center">
              {actions}
            </div>
          </div>
        </header>

        <main className="flex-1 px-6 py-6 lg:px-10">{children}</main>
      </div>
    </div>
  );
}
