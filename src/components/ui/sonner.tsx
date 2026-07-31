"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

const TOAST_DURATION_MS = 3000;

export function Toaster({ ...props }: ToasterProps) {
  return (
    <Sonner
      theme="light"
      position="bottom-right"
      closeButton
      duration={TOAST_DURATION_MS}
      richColors
      {...props}
    />
  );
}
