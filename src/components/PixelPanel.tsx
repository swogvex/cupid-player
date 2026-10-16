import type { HTMLAttributes } from "react";

export function PixelPanel({ className = "", ...rest }: HTMLAttributes<HTMLDivElement>) {
  return <div className={`px-panel ${className}`.trim()} {...rest} />;
}