"use client";

import GlobalSidebar, { type GlobalTab } from "./GlobalSidebar";

interface AppShellProps {
  activeTab: GlobalTab;
  onTabChange: (tab: GlobalTab) => void;
  children: React.ReactNode;
}

export default function AppShell({ activeTab, onTabChange, children }: AppShellProps) {
  return (
    <div className="flex h-full w-full">
      <GlobalSidebar activeTab={activeTab} onTabChange={onTabChange} />
      <div className="flex-1 overflow-y-auto">{children}</div>
    </div>
  );
}
