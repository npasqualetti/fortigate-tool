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

const STORAGE_VERSION = "v2";

function storageKey(tableId: string) {
  return `table-columns:${STORAGE_VERSION}:${tableId}`;
}

function loadStoredWidths(tableId: string, defaults: number[], minWidths: number[]) {
  if (typeof window === "undefined") {
    return { widths: defaults, fromStorage: false };
  }

  try {
    const raw = localStorage.getItem(storageKey(tableId));
    if (!raw) {
      return { widths: defaults, fromStorage: false };
    }

    const parsed = JSON.parse(raw) as number[];
    if (!Array.isArray(parsed) || parsed.length !== defaults.length) {
      return { widths: defaults, fromStorage: false };
    }

    const widths = parsed.map((width, index) => Math.max(minWidths[index], Math.round(width)));
    const total = widths.reduce((sum, width) => sum + width, 0);
    const expectedTotal = defaults.reduce((sum, width) => sum + width, 0);
    // Discard corrupt or over-compressed layouts from earlier saves.
    if (total < expectedTotal * 0.55) {
      return { widths: defaults, fromStorage: false };
    }

    return { widths, fromStorage: true };
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

export function useResizableTableColumns(
  tableId: string,
  columns: ResizableColumnDef[],
  containerRef?: RefObject<HTMLElement | null>
) {
  const defaultWidths = columns.map((column) => column.defaultWidth);
  const minWidths = columns.map((column) => column.minWidth ?? 56);

  const [widths, setWidths] = useState(defaultWidths);
  const widthsRef = useRef(widths);
  const resizeRef = useRef<ResizeState | null>(null);
  const fittedRef = useRef(false);

  useEffect(() => {
    widthsRef.current = widths;
  }, [widths]);

  const columnKey = columns.map((column) => `${column.id}:${column.defaultWidth}:${column.minWidth ?? ""}`).join("|");

  useEffect(() => {
    const loaded = loadStoredWidths(tableId, defaultWidths, minWidths);
    setWidths(loaded.widths);
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
    setWidths((current) => scaleWidthsToFit(current, minWidths, availableWidth));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- fit once per table/column definition
  }, [tableId, columnKey, containerRef]);

  const persistWidths = useCallback(
    (nextWidths: number[]) => {
      try {
        localStorage.setItem(storageKey(tableId), JSON.stringify(nextWidths));
      } catch {
        // Ignore quota or private-mode errors.
      }
    },
    [tableId]
  );

  const onResizeStart = useCallback(
    (index: number, clientX: number) => {
      resizeRef.current = {
        index,
        startX: clientX,
        startWidth: widthsRef.current[index] ?? defaultWidths[index]
      };
      document.body.style.cursor = "col-resize";
      document.body.style.userSelect = "none";
    },
    [defaultWidths]
  );

  useEffect(() => {
    function onMouseMove(event: MouseEvent) {
      const state = resizeRef.current;
      if (!state) {
        return;
      }

      const delta = event.clientX - state.startX;
      const nextWidth = Math.max(minWidths[state.index], Math.round(state.startWidth + delta));
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
  }, [minWidths, persistWidths]);

  const tableMinWidth = widths.reduce((total, width) => total + width, 0);

  return {
    widths,
    tableMinWidth,
    columnCount: columns.length,
    onResizeStart
  };
}

export type ResizableTableColumnsValue = ReturnType<typeof useResizableTableColumns>;
