import * as React from "react";
import { cn } from "@/lib/utils";

export function Badge({
  className,
  variant = "default",
  ...props
}: React.HTMLAttributes<HTMLDivElement> & {
  variant?: "default" | "secondary" | "destructive" | "outline";
}) {
  return (
    <div
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold",
        variant === "default" && "border-transparent bg-slate-900 text-white",
        variant === "secondary" && "border-transparent bg-slate-200 text-slate-900",
        variant === "destructive" && "border-transparent bg-red-700 text-white",
        variant === "outline" && "border-[var(--border)] bg-transparent text-slate-700",
        className
      )}
      {...props}
    />
  );
}
