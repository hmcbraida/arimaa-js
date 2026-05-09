/**
 * Reusable single-line text input.
 *
 * Used by the join-game modal so a labelled input is one element
 * rather than three (label + input + error span). The component is
 * uncontrolled-friendly: `value` and `onChange` go straight through
 * to the underlying input.
 */

import type { InputHTMLAttributes } from "react";
import { useId } from "react";

interface TextFieldProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, "id"> {
  readonly label: string;
  /** Optional hint or error message rendered beneath the input. */
  readonly hint?: string;
}

export function TextField({
  label,
  hint,
  className = "",
  ...rest
}: TextFieldProps) {
  // Auto-generate an id so `<label htmlFor>` is wired up without the
  // caller having to invent one.
  const id = useId();
  return (
    <div className="flex flex-col gap-1">
      <label htmlFor={id} className="text-sm font-semibold text-stone-950">
        {label}
      </label>
      <input
        id={id}
        className={`border border-stone-300 px-3 py-2 text-sm text-stone-950 focus:outline-none focus:ring-2 focus:ring-stone-950 ${className}`}
        {...rest}
      />
      {hint !== undefined && <p className="text-xs text-stone-500">{hint}</p>}
    </div>
  );
}
