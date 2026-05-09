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
 * Visual variants. Two are enough for the current screens:
 *
 * - `primary`   solid, used for the dominant action ("Submit Turn")
 * - `secondary` outlined, used for everything else
 *
 * Adding a third variant is cheap; the union type keeps misuse out at
 * the type level.
 */
type ButtonVariant = "primary" | "secondary";

/**
 * Component props. We extend the native attributes so existing prop
 * forwarding (e.g. `aria-label`) just works.
 */
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  readonly variant?: ButtonVariant;
  readonly children: ReactNode;
}

const variantClass: Record<ButtonVariant, string> = {
  primary:
    "border border-stone-950 bg-stone-950 text-stone-50 disabled:bg-transparent disabled:border-stone-300 disabled:text-stone-300",
  secondary:
    "border border-stone-950 text-stone-950 disabled:border-stone-300 disabled:text-stone-300",
};

export function Button({
  variant = "secondary",
  className = "",
  children,
  ...rest
}: ButtonProps) {
  return (
    <button
      // The `type="button"` default keeps the button from accidentally
      // submitting parent forms — a common subtle bug. Callers can
      // still override via the spread.
      type="button"
      className={`flex items-center justify-center gap-2 px-3 py-2 text-sm font-semibold disabled:cursor-not-allowed ${variantClass[variant]} ${className}`}
      {...rest}
    >
      {children}
    </button>
  );
}
