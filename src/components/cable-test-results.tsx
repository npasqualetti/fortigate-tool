import type { FortinetCableTestResult } from "@/lib/fortinet/client";
import { Badge } from "@/components/ui/badge";

export function CableTestResults({ results }: { results?: FortinetCableTestResult[] }) {
  if (!results?.length) {
    return null;
  }

  return (
    <div className="space-y-2">
      {results.map((result) => (
        <div key={result.interfaceName} className="rounded-md border border-[var(--border)] bg-slate-50 p-3 text-sm">
          <p className="flex flex-wrap items-center gap-2">
            <span className="font-mono font-semibold">{result.interfaceName}</span>
            <Badge
              variant={
                result.status === "pass"
                  ? "secondary"
                  : result.status === "unsupported"
                    ? "outline"
                    : "destructive"
              }
            >
              {result.status}
            </Badge>
          </p>
          {result.summary ? <p className="mt-1 text-[var(--muted-foreground)]">{result.summary}</p> : null}
          {result.pairs?.length ? (
            <ul className="mt-2 list-inside list-disc text-[var(--muted-foreground)]">
              {result.pairs.map((pair) => (
                <li key={`${result.interfaceName}-${pair.pair}`}>
                  {pair.pair}: {pair.status}
                  {pair.lengthMeters !== undefined ? ` (${pair.lengthMeters} m)` : ""}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  );
}
