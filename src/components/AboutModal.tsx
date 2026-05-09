import { Modal } from "./ui/Modal";

interface AboutModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** About dialog — project info and asset attribution. */
export function AboutModal({ open, onClose }: AboutModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="hmcbraida's arimaa-js">
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
