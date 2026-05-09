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
      <label htmlFor={id} className="text-sm text-tn-fg">
        {label}
      </label>
      <input
        id={id}
        className={`border border-tn-border bg-tn-panel px-3 py-2 text-sm text-tn-fg focus:outline-none focus:ring-2 focus:ring-tn-blue ${className}`}
        {...rest}
      />
      {hint !== undefined && <p className="text-xs text-tn-fg-muted">{hint}</p>}
    </div>
  );
}
