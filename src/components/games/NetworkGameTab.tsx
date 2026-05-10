/**
 * Route component for `/sessions/:id`.
 *
 * Fetches the initial snapshot from the public `GET /api/sessions/:id`
 * endpoint and mounts `NetworkGameView`. The view itself works for
 * three classes of viewer:
 *
 *   - The authenticated player on either side (interactive).
 *   - The authenticated user who is not on this session (read-only).
 *   - An anonymous spectator (read-only).
 *
 * We deliberately allow anonymous viewing of any session because the
 * URL is the bookmark / share link; locking it down would break that
 * flow. Submitting moves still requires an access token and the
 * server enforces participation.
 */

import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useNetwork } from "../../network/useNetwork";
import type { SessionSnapshot } from "../../shared/schema";
import { NetworkGameView } from "./NetworkGameView";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: SessionSnapshot }
  | { kind: "error"; message: string };

export function NetworkGameTab() {
  // The route lives under the app-shell layout route; ask the router
  // for params with `strict: false` so we get the typed `id` without
  // needing to spell out the full layout-prefixed path.
  const { id } = useParams({ strict: false }) as { id: string };
  const { gameApi } = useNetwork();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const snapshot = await gameApi.getSession(id);
        if (!cancelled) {
          setState({ kind: "ready", snapshot });
        }
      } catch (err) {
        if (!cancelled) {
          setState({
            kind: "error",
            message: err instanceof Error ? err.message : "Failed to load game",
          });
        }
      }
    };
    void load();
    return () => {
      cancelled = true;
    };
  }, [id, gameApi]);

  if (state.kind === "loading") {
    return <p className="text-sm text-stone-700">Loading game...</p>;
  }
  if (state.kind === "error") {
    return (
      <p className="text-sm text-rose-700">
        Could not load game: {state.message}
      </p>
    );
  }
  return <NetworkGameView initialSnapshot={state.snapshot} />;
}
