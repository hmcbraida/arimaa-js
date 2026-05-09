/**
 * Tab strip primitive.
 *
 * Used by the App shell to switch between the games-list tab and the
 * offline single-page game. The component is controlled — the parent
 * supplies the active tab id and an `onChange` handler — so tab state
 * can come from a router (TanStack Router) rather than from internal
 * component state.
 */

import type { ReactNode } from "react";

export interface TabDescriptor {
  readonly id: string;
  readonly label: string;
}

interface TabsProps {
  readonly tabs: readonly TabDescriptor[];
  /** The id of the tab currently active. */
  readonly activeId: string;
  /** Invoked with the new tab's id when the user clicks one. */
  readonly onChange: (id: string) => void;
  /** Content of the active tab. */
  readonly children: ReactNode;
}

export function Tabs({ tabs, activeId, onChange, children }: TabsProps) {
  return (
    <div className="flex flex-col gap-6">
      <div role="tablist" className="flex gap-2 border-b border-stone-300">
        {tabs.map((tab) => {
          const isActive = tab.id === activeId;
          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              // ARIA selected state communicates the active tab to
              // assistive tech without needing a screen-reader-only label.
              aria-selected={isActive}
              className={`-mb-px border-b-2 px-3 py-2 text-sm font-semibold ${
                isActive
                  ? "border-stone-950 text-stone-950"
                  : "border-transparent text-stone-600 hover:text-stone-950"
              }`}
              onClick={() => onChange(tab.id)}
            >
              {tab.label}
            </button>
          );
        })}
      </div>
      <div role="tabpanel">{children}</div>
    </div>
  );
}
