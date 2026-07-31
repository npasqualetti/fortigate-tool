"use client";

import { Button } from "@/components/ui/button";

export function TablePagination({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
}) {
  if (total <= pageSize) {
    return (
      <p className="text-sm text-[var(--muted-foreground)]">
        Showing {total} {total === 1 ? "row" : "rows"}.
      </p>
    );
  }

  const start = page * pageSize + 1;
  const end = Math.min((page + 1) * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <p className="text-sm text-[var(--muted-foreground)]">
        Showing {start}–{end} of {total}
      </p>
      <div className="flex items-center gap-2">
        <Button type="button" variant="outline" size="sm" disabled={page <= 0} onClick={() => onPageChange(page - 1)}>
          Previous
        </Button>
        <span className="text-sm text-[var(--muted-foreground)]">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          type="button"
          variant="outline"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
        >
          Next
        </Button>
      </div>
    </div>
  );
}
