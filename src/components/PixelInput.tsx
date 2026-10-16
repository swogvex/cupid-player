import { forwardRef, type InputHTMLAttributes } from "react";

export const PixelInput = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function PixelInput({ className = "", ...rest }, ref) {
    return <input ref={ref} className={`px-input ${className}`.trim()} {...rest} />;
  },
);