import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "icon" | "nav";

type PixelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  active?: boolean;
};

export function PixelButton({
  variant = "primary",
  active = false,
  className = "",
  type = "button",
  ...rest
}: PixelButtonProps) {
  const cls = ["px-btn", `px-btn--${variant}`, active ? "is-active" : "", className]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={cls}
      aria-current={variant === "nav" && active ? "page" : undefined}
      {...rest}
    />
  );
}