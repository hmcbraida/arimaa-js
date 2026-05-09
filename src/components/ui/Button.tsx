/**
 * Reusable button primitive for the Arimaa SPA.
 *
 * Centralizing button styling here means new screens can compose
 * `<Button variant="primary">…</Button>` without re-typing Tailwind
 * incantations, and we have one place to update if the visual design
 * changes. The component is a pass-through over the native button so
 * any standard prop (onClick, type, disabled, aria-label, etc.) works
 * unchanged.
 */

import type { ButtonHTMLAttributes, ReactNode } from "react";

/**
 * Visual variants:
 *
 * - `primary`   solid Tokyo Night blue, used for the dominant action
 * - `secondary` elevated surface, used for everything else
 *
 * Depth is signalled by a flat (zero-blur) box-shadow rather than a border.
 */
type ButtonVariant = "primary" | "secondary";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

// Colors for the flat (zero-blur) shadow — top rim + bottom drop
const SHADOW_PRIMARY = "0 -1px 0 0 rgba(255,255,255,0.12), 0 3px 0 0 #3d59a1";
const SHADOW_SECONDARY = "0 -1px 0 0 rgba(255,255,255,0.04), 0 3px 0 0 #0f1017";

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "bg-tn-blue text-tn-bg disabled:bg-tn-overlay disabled:text-tn-comment",
  secondary:
    "bg-tn-overlay text-tn-fg disabled:bg-tn-panel disabled:text-tn-comment",
};

const variantShadow: Record<ButtonVariant, string> = {
  primary: SHADOW_PRIMARY,
  secondary: SHADOW_SECONDARY,
};

export function Button({
  variant = "secondary",
  className = "",
  children,
  disabled,
  style,
  ...rest
}: ButtonProps) {
  return (
    <button
      // The `type="button"` default keeps the button from accidentally
      // submitting parent forms. Callers can still override via the spread.
      type="button"
      disabled={disabled}
      style={{
        boxShadow: disabled ? "none" : variantShadow[variant],
        ...style,
      }}
      className={`flex min-h-[44px] items-center justify-center gap-2 px-3 py-2 text-sm disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
