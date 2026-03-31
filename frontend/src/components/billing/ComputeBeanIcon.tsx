"use client";

import clsx from "clsx";

interface ComputeBeanIconProps {
  className?: string;
}

export default function ComputeBeanIcon({ className }: ComputeBeanIconProps) {
  return (
    <svg
      viewBox="0 0 32 24"
      fill="none"
      aria-hidden="true"
      className={clsx("h-3.5 w-3.5", className)}
    >
      <ellipse
        cx="10.5"
        cy="13"
        rx="6.2"
        ry="8.1"
        transform="rotate(-24 10.5 13)"
        fill="currentColor"
        opacity="0.82"
      />
      <ellipse
        cx="20.5"
        cy="11.2"
        rx="6.8"
        ry="8.8"
        transform="rotate(18 20.5 11.2)"
        fill="currentColor"
      />
      <path
        d="M18.4 5.3c2.7 0 5.1 1.1 6.3 3.1"
        stroke="rgba(255,255,255,0.78)"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
      <path
        d="M8.5 9.8c1.5-1.8 3.3-2.8 5.1-3"
        stroke="rgba(255,255,255,0.58)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
      <circle cx="25.6" cy="5.6" r="1.15" fill="rgba(255,255,255,0.92)" />
      <circle cx="26.8" cy="3.9" r="0.55" fill="rgba(255,255,255,0.68)" />
    </svg>
  );
}
