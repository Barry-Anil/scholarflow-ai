"use client";

import { DotLottieReact } from "@lottiefiles/dotlottie-react";
import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

export function AgentWorkingAnimation({ className }: { className?: string }) {
  const [motionAllowed, setMotionAllowed] = useState(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const updateMotionPreference = () => setMotionAllowed(!preference.matches);

    updateMotionPreference();
    preference.addEventListener("change", updateMotionPreference);
    return () =>
      preference.removeEventListener("change", updateMotionPreference);
  }, []);

  return (
    <DotLottieReact
      aria-hidden="true"
      autoplay={motionAllowed}
      className={cn("size-36 max-w-full", className)}
      loop
      src="/animebot.lottie"
    />
  );
}
