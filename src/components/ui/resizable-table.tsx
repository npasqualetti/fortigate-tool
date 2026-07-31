"use client";

import { createContext, useContext, useRef, type ReactNode } from "react";
import {
  useResizableTableColumns,
  type ResizableColumnDef,
  type ResizableTableColumnsValue
} from "@/hooks/use-resizable-table-columns";
import { cn } from "@/lib/utils";

const ResizableTableContext = createContext<ResizableTableColumnsValue | null>(null);

function useResizableTableContext() {
  const context = useContext(ResizableTableContext);
  if (!context) {
    throw new Error("Resizable table components must be used within ResizableTable.");
  }
  return context;
}

export function ResizableTable({
  tableId,
  columns,
  className,
  children
}: {
  tableId: string;
  columns: ResizableColumnDef[];
  className?: string;
  children: ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const value = useResizableTableColumns(tableId, columns, containerRef);

  return (
    <ResizableTableContext.Provider value={value}>
      <div ref={containerRef} className={cn("w-full min-w-0", className)}>
        {children}
      </div>
    </ResizableTableContext.Provider>
  );
}

export function ResizableTableElement({
  className,
  children
}: {
  className?: string;
  children: ReactNode;
}) {
  const { tableMinWidth } = useResizableTableContext();

  return (
    <table
      className={cn("w-full table-fixed text-left text-sm", className)}
      style={{ width: "100%", minWidth: Math.max(tableMinWidth, 0) }}
    >
      <ResizableColGroup />
      {children}
    </table>
  );
}

export function ResizableColGroup() {
  const { widths } = useResizableTableContext();

  return (
    <colgroup>
      {widths.map((width, index) => (
        <col key={index} style={{ width }} />
      ))}
    </colgroup>
  );
}

export function ResizableTh({
  columnIndex,
  className,
  children
}: {
  columnIndex: number;
  className?: string;
  children: ReactNode;
}) {
  const { widths, columnCount, onResizeStart } = useResizableTableContext();
  const isLastColumn = columnIndex >= columnCount - 1;

  return (
    <th className={cn("relative", className)} style={{ width: widths[columnIndex] }}>
      <div className="whitespace-nowrap pr-3">{children}</div>
      {!isLastColumn ? (
        <span
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize column"
          className="absolute right-0 top-0 z-20 h-full w-1.5 translate-x-1/2 cursor-col-resize touch-none bg-transparent hover:bg-[var(--primary)]/30 active:bg-[var(--primary)]/50"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
            onResizeStart(columnIndex, event.clientX);
          }}
        />
      ) : null}
    </th>
  );
}

/** Apply to body cells so resized columns truncate cleanly. */
export function resizableTdClassName(className?: string) {
  return cn("overflow-hidden truncate", className);
}
