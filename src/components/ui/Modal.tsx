/**
 * Reusable modal dialog primitive.
 *
 * Renders a centered card over a translucent backdrop. Closes on
 * backdrop click and on the Escape key — both standard interactions
 * users expect from any web-app dialog.
 *
 * The component is intentionally controlled: callers manage the
 * `open` flag and the `onClose` callback themselves so modal state
 * lives next to the screen logic that opens it.
 */

import {
  type KeyboardEvent,
  type ReactNode,
  useCallback,
  useEffect,
} from "react";

interface ModalProps {
  /** Whether the modal is currently visible. */
  readonly open: boolean;
  /** Invoked when the user requests close (backdrop, Escape, X button). */
  readonly onClose: () => void;
  /** Title rendered at the top of the dialog. */
  readonly title: string;
  /** Body content. */
  readonly children: ReactNode;
}

export function Modal({ open, onClose, title, children }: ModalProps) {
  /**
   * Listen for the Escape key on the window while the modal is open.
   *
   * We attach to the window rather than the dialog itself so the user
   * does not need to focus the dialog first; Escape is global.
   */
  useEffect(() => {
    if (!open) return;
    const onKey = (event: globalThis.KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  /**
   * Backdrop click handler. We only close if the click was on the
   * backdrop itself, not bubbled up from a child — this keeps clicks
   * inside the dialog (selecting text, pressing buttons) from
   * accidentally dismissing it.
   */
  const onBackdropClick = useCallback<
    (event: React.MouseEvent<HTMLDivElement>) => void
  >(
    (event) => {
      if (event.target === event.currentTarget) {
        onClose();
      }
    },
    [onClose],
  );

  // Stop the keydown event from bubbling out of the dialog so global
  // page hotkeys (if any are added in the future) do not also fire.
  const onKeyDown = useCallback(
    (event: KeyboardEvent<HTMLDivElement>) => event.stopPropagation(),
    [],
  );

  if (!open) return null;

  return (
    <div
      // role + aria-modal communicates intent to assistive technology.
      // We use a div + role rather than the native <dialog> element so
      // we can control visibility entirely from React state — <dialog>
      // requires imperative `showModal()` / `close()` calls that fight
      // the rest of the tree's data-flow style.
      // biome-ignore lint/a11y/useSemanticElements: see comment above
      role="dialog"
      aria-modal="true"
      aria-label={title}
      className="fixed inset-0 z-50 flex items-center justify-center bg-tn-bg/75"
      onClick={onBackdropClick}
      onKeyDown={onKeyDown}
    >
      <div className="w-full max-w-md border border-tn-border bg-tn-surface p-6">
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-lg text-tn-fg">{title}</h2>
          <button
            type="button"
            aria-label="Close dialog"
            className="text-tn-comment hover:text-tn-fg"
            onClick={onClose}
          >
            x
          </button>
        </header>
        <div className="flex flex-col gap-4">{children}</div>
      </div>
    </div>
  );
}
