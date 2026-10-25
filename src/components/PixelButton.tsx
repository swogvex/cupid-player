import type { ButtonHTMLAttributes } from "react";

type Variant = "primary" | "icon" | "nav" | "ctl" | "mini";

type PixelButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: Variant;
  active?: boolean;
  /** Only for the `ctl` variant: the bigger play button. */
  large?: boolean;
};

export function PixelButton({
  variant = "primary",
  active = false,
  large = false,
  className = "",
  type = "button",
  title,
  ...rest
}: PixelButtonProps) {
  const cls = [
    "px-btn",
    `px-btn--${variant}`,
    large ? "px-btn--lg" : "",
    active ? "is-active" : "",
    className,
  ]
    .filter(Boolean)
    .join(" ");
  return (
    <button
      type={type}
      className={cls}
      // Icon-only buttons get a tooltip for free: their aria-label.
      title={title ?? rest["aria-label"]}
      aria-current={variant === "nav" && active ? "page" : undefined}
      {...rest}
    />
  );
}