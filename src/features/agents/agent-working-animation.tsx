"use client";

import { DotLottieReact, setWasmUrl } from "@lottiefiles/dotlottie-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

// Served from /public so the renderer loads under the same-origin CSP instead of a CDN.
setWasmUrl("/dotlottie-player.wasm");

export function AgentWorkingAnimation({ className }: { className?: string }) {
  // null until the media query is read; autoplay is only honoured when the player is created.
  const [motionAllowed, setMotionAllowed] = useState<boolean | null>(null);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setMotionAllowed(!preference.matches);

    updateMotionPreference();
    preference.addEventListener("change", updateMotionPreference);
    return () =>
      preference.removeEventListener("change", updateMotionPreference);
  }, []);

  if (motionAllowed === null) {
    return (
      <div aria-hidden="true" className={cn("size-36 max-w-full", className)} />
    );
  }

  return (
    <DotLottieReact
      key={motionAllowed ? "animated" : "static"}
      aria-hidden="true"
      autoplay={motionAllowed}
      className={cn("size-36 max-w-full", className)}
      loop
      src="/animebot.lottie"
    />
  );
}
