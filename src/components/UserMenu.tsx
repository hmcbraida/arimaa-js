/**
 * The login menu in the page chrome -- replaces the previous "About"
 * button.
 *
 * Two visual modes, controlled by auth state:
 *
 *   - Signed in   the trigger shows the username next to a profile
 *                 icon. The dropdown contains an About entry, a
 *                 Preferences entry, and a red Sign-out entry.
 *   - Signed out  the trigger shows "Login". The dropdown contains
 *                 the About entry plus a blue Sign-in entry.
 *
 * About is itself a dropdown entry (not inlined into the dropdown
 * panel) so the menu stays compact and the project-info modal can
 * carry richer formatting than fits inside a popover.
 *
 * The dropdown is dismissed when clicking outside, pressing Escape,
 * or selecting one of its actions.
 */

import { useNavigate } from "@tanstack/react-router";
import { Info, LogIn, LogOut, Settings, User as UserIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useAuth } from "../auth/useAuth";
import { AboutModal } from "./AboutModal";
import { Button } from "./ui/Button";

export function UserMenu() {
  const navigate = useNavigate();
  const { state, signOut } = useAuth();
  const [open, setOpen] = useState(false);
  const [aboutOpen, setAboutOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Close on click-outside / Escape. The handlers do nothing when
  // the dropdown is already closed; we still register them and gate
  // on `open` to avoid leaking listeners.
  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (ref.current === null) return;
      if (!ref.current.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("mousedown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const isSignedIn = state.kind === "authenticated";
  const username = isSignedIn ? state.user.username : null;

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="flex items-center gap-2 px-3 py-1 text-sm text-tn-fg hover:text-tn-blue focus:outline-none focus:ring-2 focus:ring-tn-blue"
      >
        {isSignedIn ? (
          <>
            <span>{username}</span>
            <UserIcon size={16} aria-hidden />
          </>
        ) : (
          <>
            <span>Login</span>
            <LogIn size={16} aria-hidden />
          </>
        )}
      </button>
      {open && (
        <div
          role="menu"
          // Inline width so the dropdown fits action labels
          // comfortably without wrapping.
          className="absolute right-0 z-20 mt-2 flex w-56 flex-col gap-2 border border-tn-border bg-tn-panel p-3 shadow-lg"
        >
          <Button
            onClick={() => {
              setOpen(false);
              setAboutOpen(true);
            }}
          >
            <Info size={14} aria-hidden /> About
          </Button>
          {isSignedIn ? (
            <>
              <Button
                onClick={() => {
                  setOpen(false);
                  void navigate({ to: "/preferences" });
                }}
              >
                <Settings size={14} aria-hidden /> Preferences
              </Button>
              <Button
                onClick={() => {
                  setOpen(false);
                  void signOut();
                }}
                // Red destructive accent on sign-out per spec.
                style={{
                  boxShadow:
                    "0 -1px 0 0 rgba(255,255,255,0.12), 0 3px 0 0 #993939",
                }}
                className="bg-tn-red text-tn-bg hover:opacity-90"
              >
                <LogOut size={14} aria-hidden /> Sign out
              </Button>
            </>
          ) : (
            <Button
              variant="primary"
              onClick={() => {
                setOpen(false);
                void navigate({ to: "/login" });
              }}
            >
              <LogIn size={14} aria-hidden /> Sign in
            </Button>
          )}
        </div>
      )}
      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />
    </div>
  );
}
