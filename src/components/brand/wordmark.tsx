import { BookOpenCheck } from "lucide-react";
import Link from "next/link";

import { cn } from "@/lib/utils";

export function Wordmark({
  href = "/",
  inverse = false,
  className,
}: {
  href?: string;
  inverse?: boolean;
  className?: string;
}) {
  return (
    <Link
      href={href}
      className={cn("inline-flex items-center gap-2.5", className)}
    >
      <span
        className={cn(
          "grid size-9 place-items-center rounded-xl",
          inverse ? "bg-white text-slate-950" : "bg-slate-950 text-white",
        )}
      >
        <BookOpenCheck className="size-5" aria-hidden="true" />
      </span>
      <span
        className={cn(
          "text-lg font-bold tracking-tight",
          inverse ? "text-white" : "text-slate-950",
        )}
      >
        ScholarFlow <span className="text-teal-500">AI</span>
      </span>
    </Link>
  );
}
