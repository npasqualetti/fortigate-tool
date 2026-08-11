"use client";

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type RefObject } from "react";

export type ResizableColumnDef = {
  id: string;
  defaultWidth: number;
  minWidth?: number;
};

type ResizeState = {
  index: number;
  startX: number;
  startWidth: number;
};

const STORAGE_VERSION = "v3";
const MAX_AUTO_FIT_WIDTH = 640;

function storageKey(tableId: string) {
  return `table-columns:${STORAGE_VERSION}:${tableId}`;
}

function legacyStorageKey(tableId: string) {
  return `table-columns:v2:${tableId}`;
}

function widthsFromColumnMap(
  columns: ResizableColumnDef[],
  minWidths: number[],
  stored: Record<string, number>
) {
  return columns.map((column, index) =>
    Math.max(minWidths[index], Math.round(stored[column.id] ?? column.defaultWidth))
  );
}

function loadStoredWidths(tableId: string, columns: ResizableColumnDef[], minWidths: number[]) {
  const defaults = columns.map((column) => column.defaultWidth);

  if (typeof window === "undefined") {
    return { widths: defaults, fromStorage: false };
  }

  try {
    const raw =
      localStorage.getItem(storageKey(tableId)) ?? localStorage.getItem(legacyStorageKey(tableId));
    if (!raw) {
      return { widths: defaults, fromStorage: false };
    }

    const parsed = JSON.parse(raw) as unknown;

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const widths = widthsFromColumnMap(columns, minWidths, parsed as Record<string, number>);
      const total = widths.reduce((sum, width) => sum + width, 0);
      const expectedTotal = defaults.reduce((sum, width) => sum + width, 0);
      if (total < expectedTotal * 0.55) {
        return { widths: defaults, fromStorage: false };
      }
      return { widths, fromStorage: true };
    }

    if (Array.isArray(parsed) && parsed.length === defaults.length) {
      const widths = parsed.map((width, index) => Math.max(minWidths[index], Math.round(width)));
      const total = widths.reduce((sum, width) => sum + width, 0);
      const expectedTotal = defaults.reduce((sum, width) => sum + width, 0);
      if (total < expectedTotal * 0.55) {
        return { widths: defaults, fromStorage: false };
      }
      return { widths, fromStorage: true };
    }

    return { widths: defaults, fromStorage: false };
  } catch {
    return { widths: defaults, fromStorage: false };
  }
}

function scaleWidthsToFit(widths: number[], minWidths: number[], availableWidth: number) {
  const total = widths.reduce((sum, width) => sum + width, 0);
  if (total <= 0 || availableWidth <= 0 || total === availableWidth) {
    return widths;
  }

  const scale = availableWidth / total;
  return widths.map((width, index) => Math.max(minWidths[index], Math.round(width * scale)));
}

function measureCellContentWidth(cell: HTMLElement) {
  const clone = cell.cloneNode(true) as HTMLElement;
  clone.style.position = "absolute";
  clone.style.visibility = "hidden";
  clone.style.width = "auto";
  clone.style.maxWidth = "none";
  clone.style.overflow = "visible";
  clone.style.whiteSpace = "nowrap";
  clone.classList.remove("truncate");
  clone.querySelectorAll("*").forEach((node) => {
    if (node instanceof HTMLElement) {
      node.classList.remove("truncate");
      node.style.overflow = "visible";
      node.style.whiteSpace = "nowrap";
    }
  });

  document.body.appendChild(clone);
  const width = Math.ceil(clone.getBoundingClientRect().width);
  document.body.removeChild(clone);
  return width;
}

function widthsEqual(left: number[], right: number[]) {
  return left.length === right.length && left.every((width, index) => width === right[index]);
}

function minWidthsFor(columns: ResizableColumnDef[]) {
  return columns.map((column) => column.minWidth ?? 56);
}

export function useResizableTableColumns(
  tableId: string,
  columns: ResizableColumnDef[],
  containerRef?: RefObject<HTMLElement | null>
) {
  const columnsRef = useRef(columns);
  columnsRef.current = columns;

  const columnKey = columns.map((column) => `${column.id}:${column.defaultWidth}:${column.minWidth ?? ""}`).join("|");

  const [widths, setWidths] = useState(() => columns.map((column) => column.defaultWidth));
  const widthsRef = useRef(widths);
  const resizeRef = useRef<ResizeState | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  useEffect(() => {
    const currentColumns = columnsRef.current;
    const currentMinWidths = minWidthsFor(currentColumns);
    const loaded = loadStoredWidths(tableId, currentColumns, currentMinWidths);
    setWidths((current) => (widthsEqual(current, loaded.widths) ? current : loaded.widths));
    fittedRef.current = !loaded.fromStorage;
  }, [tableId, columnKey]);

  useLayoutEffect(() => {
    if (!fittedRef.current || !containerRef?.current) {
      return;
    }

    const availableWidth = containerRef.current.clientWidth;
    if (availableWidth <= 0) {
      return;
    }

    fittedRef.current = false;
    const currentMinWidths = minWidthsFor(columnsRef.current);
    setWidths((current) => {
      const next = scaleWidthsToFit(current, currentMinWidths, availableWidth);
      return widthsEqual(current, next) ? current : next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit once per table/column definition
  }, [tableId, columnKey, containerRef]);

  const persistWidths = useCallback(
    (nextWidths: number[]) => {
      try {
        const existingRaw = localStorage.getItem(storageKey(tableId));
        let existing: Record<string, number> = {};
        if (existingRaw) {
          const parsed = JSON.parse(existingRaw) as unknown;
          if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
            existing = parsed as Record<string, number>;
          }
        }

        columnsRef.current.forEach((column, index) => {
          existing[column.id] = nextWidths[index];
        });

        localStorage.setItem(storageKey(tableId), JSON.stringify(existing));
      } catch {
        // Ignore quota or private-mode errors.
      }
    },
    [tableId]
  );

  const onResizeStart = useCallback((index: number, clientX: number) => {
    const currentColumns = columnsRef.current;
    resizeRef.current = {
      index,
      startX: clientX,
      startWidth: widthsRef.current[index] ?? currentColumns[index]?.defaultWidth ?? 56
    };
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }, []);

  const onAutoFitColumn = useCallback(
    (index: number) => {
      const table = containerRef?.current?.querySelector("table");
      if (!table) {
        return;
      }

      const currentMinWidths = minWidthsFor(columnsRef.current);
      let maxWidth = currentMinWidths[index] ?? 56;
      const headerCell = table.querySelectorAll("thead tr th")[index];
      if (headerCell instanceof HTMLElement) {
        maxWidth = Math.max(maxWidth, measureCellContentWidth(headerCell));
      }

      table.querySelectorAll("tbody tr").forEach((row) => {
        const cell = row.children[index];
        if (cell instanceof HTMLTableCellElement && cell.colSpan === 1) {
          maxWidth = Math.max(maxWidth, measureCellContentWidth(cell));
        }
      });

      const nextWidth = Math.min(Math.max(currentMinWidths[index] ?? 56, maxWidth + 12), MAX_AUTO_FIT_WIDTH);
      setWidths((current) => {
        if (current[index] === nextWidth) {
          return current;
        }
        const next = [...current];
        next[index] = nextWidth;
        widthsRef.current = next;
        persistWidths(next);
        return next;
      });
    },
    [containerRef, persistWidths]
  );

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const state = resizeRef.current;
      if (!state) {
        return;
      }

      const currentMinWidths = minWidthsFor(columnsRef.current);
      const delta = event.clientX - state.startX;
      const nextWidth = Math.max(currentMinWidths[state.index] ?? 56, Math.round(state.startWidth + delta));
      setWidths((current) => {
        if (current[state.index] === nextWidth) {
          return current;
        }
        const next = [...current];
        next[state.index] = nextWidth;
        return next;
      });
    }

    function onMouseUp() {
      if (!resizeRef.current) {
        return;
      }

      resizeRef.current = null;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      persistWidths(widthsRef.current);
    }

    window.addEventListener("mousemove", onMouseMove);
    window.addEventListener("mouseup", onMouseUp);
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseup", onMouseUp);
    };
  }, [persistWidths]);

  const tableMinWidth = widths.reduce((total, width) => total + width, 0);

  return {
    widths,
    tableMinWidth,
    columnCount: columns.length,
    onResizeStart,
    onAutoFitColumn
  };
}

export type ResizableTableColumnsValue = ReturnType<typeof useResizableTableColumns>;
