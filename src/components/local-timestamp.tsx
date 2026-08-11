"use client";

import { useEffect, useState } from "react";
import { formatStoredTimestamp } from "@/lib/format-timestamp";

/** Formats on the client so locale and timezone match the user's computer settings. */
export function LocalTimestamp({
  value,
  fallback = "—",
  className
}: {
  value: string | null | undefined;
  fallback?: string;
  className?: string;
}) {
  const [label, setLabel] = useState(fallback);

  useEffect(() => {
    setLabel(formatStoredTimestamp(value));
  }, [value]);

  return (
    <span suppressHydrationWarning className={className} title={label !== fallback ? label : undefined}>
      {label}
    </span>
  );
}
