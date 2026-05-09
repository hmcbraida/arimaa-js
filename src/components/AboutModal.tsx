import { Modal } from "./ui/Modal";

interface AboutModalProps {
  readonly open: boolean;
  readonly onClose: () => void;
}

/** About dialog — project info and asset attribution. */
export function AboutModal({ open, onClose }: AboutModalProps) {
  return (
    <Modal open={open} onClose={onClose} title="hmcbraida's arimaa-js">
      <p className="text-stone-700">
        An open-source implementation of the{" "}
        <a
          href="https://arimaa.com/arimaa/"
          target="_blank"
          rel="noopener noreferrer"
          className="underline hover:text-stone-950"
        >
          Arimaa
        </a>{" "}
        board game.
      </p>
      <a
        href="https://github.com/hmcbraida/arimaa-js"
        target="_blank"
        rel="noopener noreferrer"
        className="text-stone-700 underline hover:text-stone-950"
      >
        github.com/hmcbraida/arimaa-js
      </a>
      <div className="border-t border-stone-200 pt-3">
        <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-stone-500">
          Credits
        </p>
        <p className="text-sm text-stone-600">
          Piece icons by{" "}
          <a
            href="https://game-icons.net"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-950"
          >
            game-icons.net
          </a>
          , authors Lorc and Delapouite, licensed under{" "}
          <a
            href="https://creativecommons.org/licenses/by/3.0/"
            target="_blank"
            rel="noopener noreferrer"
            className="underline hover:text-stone-950"
          >
            CC BY 3.0
          </a>
          .
        </p>
      </div>
    </Modal>
  );
}
