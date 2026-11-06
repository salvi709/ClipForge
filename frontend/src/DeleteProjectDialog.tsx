import { useEffect, useRef } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
import { Project } from "./api";

export default function DeleteProjectDialog({
  project,
  deleting,
  error,
  onCancel,
  onConfirm,
}: {
  project: Project;
  deleting: boolean;
  error: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    element?.showModal();
    return () => element?.close();
  }, []);
  return (
    <dialog
      ref={dialog}
      className="delete-dialog"
      aria-labelledby="delete-title"
      aria-describedby="delete-description"
      onCancel={(event) => {
        event.preventDefault();
        if (!deleting) onCancel();
      }}
    >
      <div className="section-label">
        <Trash2 size={16} /> PROJECT STORAGE
      </div>
      <h2 id="delete-title">Delete project permanently?</h2>
      <p className="delete-filename">{project.filename}</p>
      <p id="delete-description">
        This permanently removes this project's uploaded video, transcript, clip
        suggestions, saved timing changes, and temporary files from ClipForge.
        This cannot be undone. Your original imported file and shared models are
        kept.
      </p>
      {error && (
        <p role="alert" className="warning-text">
          {error}
        </p>
      )}
      <div className="delete-actions">
        <button
          className="secondary"
          autoFocus
          disabled={deleting}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          className="secondary delete-confirm"
          disabled={deleting}
          onClick={onConfirm}
        >
          {deleting ? (
            <LoaderCircle size={15} className="spin" />
          ) : (
            <Trash2 size={15} />
          )}
          {deleting ? "Deleting…" : "Delete permanently"}
        </button>
      </div>
    </dialog>
  );
}
