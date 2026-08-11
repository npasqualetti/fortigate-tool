"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

function readCookie(name: string) {
  if (typeof document === "undefined") {
    return null;
  }
  const entry = document.cookie.split("; ").find((row) => row.startsWith(`${name}=`));
  if (!entry) {
    return null;
  }
  return decodeURIComponent(entry.slice(name.length + 1));
}

function writeCookie(name: string, value: string) {
  document.cookie = `${name}=${encodeURIComponent(value)}; path=/; max-age=31536000; SameSite=Lax`;
}

export function useColumnVisibilityCookie(cookieName: string, columnIds: string[]) {
  const defaults = useMemo(() => Object.fromEntries(columnIds.map((id) => [id, true])), [columnIds]);

  const [visible, setVisible] = useState<Record<string, boolean>>(defaults);

  useEffect(() => {
    const raw = readCookie(cookieName);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      setVisible({ ...defaults, ...parsed });
    } catch {
      // Ignore invalid cookie payloads.
    }
  }, [cookieName, defaults]);

  const setColumnVisible = useCallback(
    (columnId: string, isVisible: boolean) => {
      setVisible((current) => {
        const next = { ...current, [columnId]: isVisible };
        writeCookie(cookieName, JSON.stringify(next));
        return next;
      });
    },
    [cookieName]
  );

  const visibleColumnIds = useMemo(
    () => columnIds.filter((columnId) => visible[columnId] !== false),
    [columnIds, visible]
  );

  return {
    visible,
    visibleColumnIds,
    setColumnVisible
  };
}
