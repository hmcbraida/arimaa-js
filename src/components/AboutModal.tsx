/**
 * About modal -- project info and asset attribution.
 */

import { Modal } from "./ui/Modal";

interface AboutModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

export function AboutModal({ open, onClose }: AboutModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="Arimaatic">
      <div className="rounded border border-yellow-500/40 bg-yellow-500/10 px-3 py-2 text-sm text-yellow-400">
        ⚠ Heavy work in progress.
      </div>
      <p className="text-tn-fg-muted">
        An open-source implementation of the{" "}
        <a
          href="https://arimaa.com/arimaa/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-tn-blue"
        >
          Arimaa
        </a>{" "}
        board game.
      </p>
      <a
        href="https://github.com/hmcbraida/arimaa-js"
        target="_blank"
        rel="noopener noreferrer"
        className="text-tn-fg-muted underline hover:text-tn-blue"
      >
        github.com/hmcbraida/arimaa-js
      </a>
      <div className="border-t border-tn-border pt-3">
        <p className="mb-1 text-xs uppercase tracking-wide text-tn-fg-muted">
          Credits
        </p>
        <p className="text-sm text-tn-fg-muted">
          Piece icons by{" "}
          <a
            href="https://game-icons.net"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-tn-blue"
          >
            game-icons.net
          </a>
          , authors Lorc and Delapouite, licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/3.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-tn-blue"
          >
            CC BY 3.0
          </a>
          .
        </p>
      </div>
    </Modal>
  );
}
