/**
 * Games tab — the default view of the SPA.
 *
 * Shows a paginated table of every session this browser has been
 * involved in (player or spectator). Above the table sits a pair of
 * buttons that open the new-game and join-game modals. Clicking a
 * row navigates to that session.
 *
 * The list itself is read from localStorage on mount; the per-row
 * status (whose turn it is, completion) is hydrated from the API so
 * users can scan a stale list and still see fresh status text. The
 * hydration runs once per page change so we never call the API for
 * games not currently visible.
 */

import { useNavigate } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";
import { type StoredGame, listStoredGames } from "../../network/storage";
import { useNetwork } from "../../network/useNetwork";
import type { SessionSnapshot } from "../../shared/schema";
import { Button } from "../ui/Button";
import { Table } from "../ui/Table";
import { JoinGameModal } from "./JoinGameModal";
import { NewGameModal } from "./NewGameModal";

const PAGE_SIZE = 10;

/**
 * Format a session status for the table cell.
 *
 * The wire-format status is short ("waiting" / "gold" / "silver" /
 * "completed") so we only need to dress it up for display.
 */
function describeStatus(snapshot: SessionSnapshot | undefined): string {
  if (snapshot === undefined) return "Loading...";
  switch (snapshot.status) {
    case "waiting":
      return "Waiting for opponent";
    case "gold":
      return "Gold's turn";
    case "silver":
      return "Silver's turn";
    case "completed":
      return snapshot.winner !== null
        ? `${snapshot.winner === "gold" ? "Gold" : "Silver"} won (${snapshot.reason ?? "unknown"})`
        : "Completed";
  }
}

export function GamesTab() {
  const { api } = useNetwork();
  const navigate = useNavigate();

  // We mirror the localStorage list into component state so a row added
  // by a modal triggers a re-render. We re-read on mount and after
  // either modal closes successfully.
  const [games, setGames] = useState<StoredGame[]>(() => listStoredGames());
  const [page, setPage] = useState(0);
  const [snapshots, setSnapshots] = useState<Record<string, SessionSnapshot>>(
    {},
  );
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  // Slice the visible page out of the full list. The full list is
  // already sorted newest-first by `listStoredGames`.
  const visible = useMemo(
    () => games.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE),
    [games, page],
  );
  const totalPages = Math.max(1, Math.ceil(games.length / PAGE_SIZE));

  /**
   * Hydrate snapshots for every visible row whenever the page changes.
   *
   * We fire requests in parallel and ignore individual failures (a
   * deleted session, for instance). A best-effort approach is the
   * right call here — the table is informational, not critical.
   */
  useEffect(() => {
    let cancelled = false;
    void Promise.all(
      visible.map(async (game) => {
        try {
          const snap = await api.getSession(game.sessionId);
          if (!cancelled) {
            setSnapshots((prev) => ({ ...prev, [game.sessionId]: snap }));
          }
        } catch {
          // Ignore — we render a fallback in describeStatus.
        }
      }),
    );
    return () => {
      cancelled = true;
    };
  }, [visible, api]);

  const refreshList = () => {
    setGames(listStoredGames());
    setPage(0);
  };

  // Memoise the column descriptors so React doesn't re-create the
  // array on every render — a tiny detail but it keeps the table
  // pure-render-friendly.
  const columns = useMemo(
    () => [
      {
        id: "side",
        header: "You",
        render: (row: StoredGame) =>
          row.role === "player" && row.side !== null
            ? row.side[0].toUpperCase() + row.side.slice(1)
            : "Spectator",
      },
      {
        id: "status",
        header: "Status",
        render: (row: StoredGame) => describeStatus(snapshots[row.sessionId]),
      },
      {
        id: "added",
        header: "Added",
        render: (row: StoredGame) => new Date(row.addedAt).toLocaleString(),
      },
      {
        id: "id",
        header: "Session",
        className: "font-mono text-xs text-tn-comment",
        render: (row: StoredGame) => row.sessionId.slice(0, 8),
      },
    ],
    [snapshots],
  );

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          Start new game
        </Button>
        <Button onClick={() => setJoinOpen(true)}>Join a game</Button>
      </div>

      <Table
        columns={columns}
        rows={visible}
        getRowId={(row) => row.sessionId}
        onRowClick={(row) =>
          void navigate({ to: "/sessions/$id", params: { id: row.sessionId } })
        }
        emptyMessage="You have not joined any games yet. Start a new one above, or join with an 8-digit code."
      />

      {games.length > PAGE_SIZE && (
        <nav
          aria-label="Pagination"
          className="flex items-center justify-between text-sm text-tn-fg-muted"
        >
          <Button
            onClick={() => setPage((p) => Math.max(0, p - 1))}
            disabled={page === 0}
          >
            Previous
          </Button>
          <span>
            Page {page + 1} of {totalPages}
          </span>
          <Button
            onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))}
            disabled={page >= totalPages - 1}
          >
            Next
          </Button>
        </nav>
      )}

      <NewGameModal
        open={newOpen}
        onClose={() => {
          setNewOpen(false);
          refreshList();
        }}
        onCreated={(id) => {
          setNewOpen(false);
          refreshList();
          void navigate({ to: "/sessions/$id", params: { id } });
        }}
      />
      <JoinGameModal
        open={joinOpen}
        onClose={() => {
          setJoinOpen(false);
          refreshList();
        }}
        onJoined={(id) => {
          setJoinOpen(false);
          refreshList();
          void navigate({ to: "/sessions/$id", params: { id } });
        }}
      />
    </section>
  );
}
