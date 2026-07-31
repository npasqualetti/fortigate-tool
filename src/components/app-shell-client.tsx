"use client";

import { PingMonitorProvider } from "@/components/ping-monitor-provider";

export function AppShellClient({ children }: { children: React.ReactNode }) {
  return <PingMonitorProvider>{children}</PingMonitorProvider>;
}
