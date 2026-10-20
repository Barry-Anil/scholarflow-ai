"use client";

import { X } from "lucide-react";
import { useEffect, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type DrawerProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: ReactNode;
  headerActions?: ReactNode;
  widthClassName?: string;
};

export function Drawer({
  isOpen,
  onClose,
  title,
  description,
  children,
  headerActions,
  widthClassName = "w-full max-w-2xl",
}: DrawerProps) {
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex justify-end"
    >
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-slate-950/40 backdrop-blur-xs transition-opacity animate-in fade-in duration-200"
        onClick={onClose}
        aria-hidden="true"
      />

      {/* Drawer Panel */}
      <div
        className={cn(
          "relative z-10 flex h-full flex-col border-l border-slate-200 bg-white shadow-2xl transition-transform animate-in slide-in-from-right duration-300",
          widthClassName,
        )}
      >
        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b border-slate-200 px-6 py-4.5 bg-slate-50/50">
          <div className="min-w-0 flex-1 pr-4">
            <h2 className="text-lg font-semibold tracking-tight text-slate-900">
              {title}
            </h2>
            {description && (
              <p className="mt-1 text-xs leading-5 text-slate-500">
                {description}
              </p>
            )}
            {headerActions && <div className="mt-3">{headerActions}</div>}
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            aria-label="Close drawer"
            className="shrink-0 -mr-2 text-slate-400 hover:text-slate-700"
          >
            <X className="size-5" />
          </Button>
        </div>

        {/* Scrollable Body */}
        <div className="flex-1 overflow-y-auto px-6 py-5">{children}</div>
      </div>
    </div>
  );
}
