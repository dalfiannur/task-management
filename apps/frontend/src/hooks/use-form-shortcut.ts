import { useEffect } from "react";

export function useFormShortcut(
  open: boolean,
  formSelector: string,
  canSubmit: boolean,
): void {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter" && canSubmit) {
        e.preventDefault();
        const form = document.querySelector<HTMLFormElement>(formSelector);
        form?.requestSubmit();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [open, formSelector, canSubmit]);
}
