/**
 * Games tab -- the default view of the SPA.
 *
 * Two visual modes:
 *
 *   - **Anonymous**     prompts the user to sign in. The whole table
 *                       is hidden because online games are gated to
 *                       authenticated users per spec; anonymous users
 *                       can still spectate via a `/sessions/:id` URL.
 *   - **Authenticated** shows the user's paginated game list fetched
 *                       from `GET /api/users/me/sessions`. Click a
 *                       row to open the game.
 *
 * Pagination is keyset-based using the cursor returned by the server.
 * We keep the "load more" semantics simple: a single forward cursor
 * with no back-button. If users frequently want to revisit older
 * pages we can add a stack of cursors here later.
 */

import { Link, useNavigate } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import { useAuth } from "../../auth/useAuth";
import { useNetwork } from "../../network/useNetwork";
import type { SessionListEntry } from "../../shared/schema";
import { Button } from "../ui/Button";
import { Table } from "../ui/Table";
import { JoinGameModal } from "./JoinGameModal";
import { NewGameModal } from "./NewGameModal";

const PAGE_SIZE = 10;

/**
 * Format a list-entry status for the table cell.
 *
 * `whoseTurn` is computed by the server from the viewer's perspective,
 * so we use it directly rather than re-deriving from `sideToMove`.
 */
function describeStatus(entry: SessionListEntry): string {
  switch (entry.status) {
    case "waiting":
      return "Waiting for opponent";
    case "completed":
      return entry.winner !== null
        ? `${entry.winner === "gold" ? "Gold" : "Silver"} won (${entry.reason ?? "unknown"})`
        : "Completed";
    case "gold":
    case "silver":
      return entry.whoseTurn === "you" ? "Your turn" : "Opponent's turn";
  }
}

export function GamesTab() {
  const { state, accessToken } = useAuth();
  const { gameApi } = useNetwork();
  const navigate = useNavigate();

  const [entries, setEntries] = useState<SessionListEntry[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);
  const [joinOpen, setJoinOpen] = useState(false);

  const isAuthenticated = state.kind === "authenticated";

  /**
   * Fetch a page of games. `replace` resets the list (used after a
   * modal succeeds); otherwise we append.
   */
  const loadPage = useCallback(
    async (cursor: string | null, replace: boolean) => {
      const at = accessToken();
      if (at === null) return;
      setLoading(true);
      setError(null);
      try {
        const page = await gameApi.listMySessions({
          accessToken: at,
          query: { limit: PAGE_SIZE, cursor: cursor ?? undefined },
        });
        setEntries((prev) =>
          replace ? page.sessions.slice() : [...prev, ...page.sessions],
        );
        setNextCursor(page.nextCursor);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load games");
      } finally {
        setLoading(false);
      }
    },
    [accessToken, gameApi],
  );

  // Initial load when we transition into authenticated state.
  useEffect(() => {
    if (!isAuthenticated) {
      setEntries([]);
      setNextCursor(null);
      return;
    }
    void loadPage(null, true);
  }, [isAuthenticated, loadPage]);

  const refreshList = useCallback(() => loadPage(null, true), [loadPage]);

  const columns = useMemo(
    () => [
      {
        id: "side",
        header: "You",
        render: (row: SessionListEntry) =>
          row.yourSide[0].toUpperCase() + row.yourSide.slice(1),
      },
      {
        id: "status",
        header: "Status",
        render: (row: SessionListEntry) => describeStatus(row),
      },
      {
        id: "opponent",
        header: "Opponent",
        render: (row: SessionListEntry) => {
          const opponentSide = row.yourSide === "gold" ? "silver" : "gold";
          return row.participants[opponentSide]?.username ?? "—";
        },
      },
      {
        id: "added",
        header: "Created",
        render: (row: SessionListEntry) =>
          new Date(row.createdAt).toLocaleString(),
      },
      {
        id: "id",
        header: "Session",
        className: "font-mono text-xs text-tn-comment",
        render: (row: SessionListEntry) => row.id.slice(0, 8),
      },
    ],
    [],
  );

  // Anonymous-mode prompt.
  if (!isAuthenticated) {
    return (
      <section className="flex flex-col gap-4">
        <div className="border border-tn-border bg-tn-panel p-6 text-sm text-tn-fg">
          <p>Sign in to play online games.</p>
        </div>
        <div className="flex gap-2">
          <Link
            to="/login"
            className="flex min-h-[44px] items-center justify-center bg-tn-blue px-4 py-2 text-sm text-tn-bg"
          >
            Sign in
          </Link>
        </div>
      </section>
    );
  }

  return (
    <section className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="primary" onClick={() => setNewOpen(true)}>
          Start new game
        </Button>
        <Button onClick={() => setJoinOpen(true)}>Join a game</Button>
      </div>

      {error !== null && (
        <p
          role="alert"
          className="border border-tn-red/50 bg-tn-red/10 px-3 py-2 text-sm text-tn-red"
        >
          {error}
        </p>
      )}

      <Table
        columns={columns}
        rows={entries}
        getRowId={(row) => row.id}
        onRowClick={(row) =>
          void navigate({ to: "/sessions/$id", params: { id: row.id } })
        }
        emptyMessage={
          loading
            ? "Loading..."
            : "You have not joined any games yet. Start a new one above, or join with an 8-digit code."
        }
      />

      {nextCursor !== null && (
        <div className="flex justify-center">
          <Button
            onClick={() => void loadPage(nextCursor, false)}
            disabled={loading}
          >
            {loading ? "Loading..." : "Load more"}
          </Button>
        </div>
      )}

      <NewGameModal
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(id) => {
          setNewOpen(false);
          void refreshList();
          void navigate({ to: "/sessions/$id", params: { id } });
        }}
      />
      <JoinGameModal
        open={joinOpen}
        onClose={() => setJoinOpen(false)}
        onJoined={(id) => {
          setJoinOpen(false);
          void refreshList();
          void navigate({ to: "/sessions/$id", params: { id } });
        }}
      />
    </section>
  );
}
