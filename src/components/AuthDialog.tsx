import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";

interface AuthDialogProps {
  open: boolean;
  onClose: () => void;
  onEmailAuth: (email: string, password: string, mode: "signin" | "signup") => Promise<void>;
}

export function AuthDialog({ open, onClose, onEmailAuth }: AuthDialogProps) {
  const dialogRef = useRef<HTMLDialogElement | null>(null);
  const [mode, setMode] = useState<"signin" | "signup">("signin");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  useEffect(() => {
    const dlg = dialogRef.current;
    if (!dlg) return;
    if (open && !dlg.open) {
      dlg.showModal();
    } else if (!open && dlg.open) {
      dlg.close();
    }
  }, [open]);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setErrorMsg(null);
    setSubmitting(true);
    try {
      await onEmailAuth(email.trim(), password, mode);
      setPassword("");
      onClose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : "Unable to complete sign-in.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <dialog
      ref={dialogRef}
      className="auth-dialog"
      aria-labelledby="auth-dialog-title"
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
    >
      <div className="dialog-header">
        <h2 id="auth-dialog-title">
          {mode === "signin" ? "Email & Password Sign-In" : "Create De-Identified Vault Account"}
        </h2>
        <button
          type="button"
          className="btn-icon"
          onClick={onClose}
          aria-label="Close sign-in dialog"
        >
          <X size={18} aria-hidden="true" />
        </button>
      </div>

      <p className="dialog-desc">
        Sync de-identified clinical summaries across browsers and keep offline local access intact.
        Raw personal identifiers are never uploaded.
      </p>

      <div className="tab-row" role="group" aria-label="Authentication mode">
        <button
          type="button"
          className={`btn-tab ${mode === "signin" ? "active" : ""}`}
          onClick={() => {
            setMode("signin");
            setErrorMsg(null);
          }}
        >
          Sign In
        </button>
        <button
          type="button"
          className={`btn-tab ${mode === "signup" ? "active" : ""}`}
          onClick={() => {
            setMode("signup");
            setErrorMsg(null);
          }}
        >
          Create Account
        </button>
      </div>

      <form onSubmit={handleSubmit} className="auth-form">
        <div className="field-group">
          <label htmlFor="vault-auth-email">Email Address</label>
          <input
            id="vault-auth-email"
            type="email"
            required
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        <div className="field-group">
          <label htmlFor="vault-auth-password">Password (minimum 6 characters)</label>
          <input
            id="vault-auth-password"
            type="password"
            required
            minLength={6}
            autoComplete={mode === "signin" ? "current-password" : "new-password"}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </div>

        {errorMsg && (
          <p className="alert-error" role="alert">
            {errorMsg}
          </p>
        )}

        <div className="dialog-actions">
          <button type="button" className="btn-secondary" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn-primary" disabled={submitting}>
            {submitting
              ? "Working..."
              : mode === "signin"
              ? "Sign In"
              : "Create Account"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
