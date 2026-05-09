/**
 * Route component for `/sessions/:id`.
 *
 * Fetches the initial snapshot, reads any stored player credential
 * from localStorage, and mounts `NetworkGameView`. Loading and error
 * states live here so the inner view can assume it always has a
 * resolved snapshot.
 */

import { useParams } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import {
  type StoredGame,
  getStoredGame,
  upsertStoredGame,
} from "../../network/storage";
import { useNetwork } from "../../network/useNetwork";
import type { SessionSnapshot } from "../../shared/schema";
import { NetworkGameView } from "./NetworkGameView";

type LoadState =
  | { kind: "loading" }
  | { kind: "ready"; snapshot: SessionSnapshot; stored: StoredGame | null }
  | { kind: "error"; message: string };

export function NetworkGameTab() {
  const { id } = useParams({ from: "/sessions/$id" });
  const { api } = useNetwork();
  const [state, setState] = useState<LoadState>({ kind: "loading" });

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      setState({ kind: "loading" });
      try {
        const snapshot = await api.getSession(id);
        // Any browser visiting the URL becomes a spectator entry in
        // their local games list, so the shared URL is also a
        // bookmark to the games tab.
        const existing = getStoredGame(id);
        if (existing === null) {
          upsertStoredGame({
            sessionId: id,
            role: "spectator",
            side: null,
            secretToken: null,
            acceptToken: null,
            addedAt: new Date().toISOString(),
          });
        }
        const stored = getStoredGame(id);
        if (!cancelled) {
          setState({ kind: "ready", snapshot, stored });
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
  }, [id, api]);

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
  return (
    <NetworkGameView initialSnapshot={state.snapshot} stored={state.stored} />
  );
}
