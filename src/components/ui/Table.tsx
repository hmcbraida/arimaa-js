/**
 * Reusable table primitive used by the games-list tab.
 *
 * The component provides the basic structural styling (header, rows,
 * borders) and an `onRowClick` callback so the parent can navigate to
 * a game when a row is clicked. Columns are passed as descriptor
 * objects rather than rendered children so the same component can
 * handle pagination, empty state, and a11y in one place.
 */

import type { ReactNode } from "react";

/**
 * Description of a single column.
 *
 * `render` is required (rather than just naming a key) because a
 * column often presents derived data — e.g. converting an ISO date
 * into a human-friendly relative time.
 */
export interface TableColumn<TRow> {
  readonly id: string;
  readonly header: ReactNode;
  readonly render: (row: TRow) => ReactNode;
  readonly className?: string;
}

interface TableProps<TRow> {
  readonly columns: readonly TableColumn<TRow>[];
  readonly rows: readonly TRow[];
  /** Used as a stable React key for each row. */
  readonly getRowId: (row: TRow) => string;
  readonly onRowClick?: (row: TRow) => void;
  readonly emptyMessage?: ReactNode;
}

export function Table<TRow>({
  columns,
  rows,
  getRowId,
  onRowClick,
  emptyMessage,
}: TableProps<TRow>) {
  if (rows.length === 0 && emptyMessage !== undefined) {
    return (
      <div className="border border-stone-300 p-6 text-center text-sm text-stone-500">
        {emptyMessage}
      </div>
    );
  }

  return (
    <table className="w-full border-collapse border border-stone-300 text-sm text-stone-950">
      <thead className="bg-stone-100">
        <tr>
          {columns.map((col) => (
            <th
              key={col.id}
              className={`border-b border-stone-300 px-3 py-2 text-left text-stone-700 ${col.className ?? ""}`}
            >
              {col.header}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const id = getRowId(row);
          // Rows are clickable when `onRowClick` is supplied; we make
          // the row itself a button-like element via role + tabindex
          // so keyboard users can activate it too.
          const interactive = onRowClick !== undefined;
          return (
            <tr
              key={id}
              role={interactive ? "button" : undefined}
              tabIndex={interactive ? 0 : undefined}
              onClick={interactive ? () => onRowClick?.(row) : undefined}
              onKeyDown={
                interactive
                  ? (event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        onRowClick?.(row);
                      }
                    }
                  : undefined
              }
              className={`border-b border-stone-200 ${interactive ? "cursor-pointer hover:bg-stone-100" : ""}`}
            >
              {columns.map((col) => (
                <td key={col.id} className={`px-3 py-2 ${col.className ?? ""}`}>
                  {col.render(row)}
                </td>
              ))}
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
