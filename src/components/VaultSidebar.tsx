import { LogIn, LogOut, Trash2, UserCheck, Vault } from "lucide-react";
import type { User } from "firebase/auth";
import type { VaultRecord } from "../types";

interface VaultSidebarProps {
  user: User | null;
  authBusy: boolean;
  authError: string | null;
  records: VaultRecord[];
  activeRecordId: string | null;
  onGuestSignIn: () => Promise<void>;
  onOpenEmailAuth: () => void;
  onSignOut: () => Promise<void>;
  onLoadRecord: (rec: VaultRecord) => void;
  onDeleteRecord: (id: string) => Promise<void>;
}

export function VaultSidebar({
  user,
  authBusy,
  authError,
  records,
  activeRecordId,
  onGuestSignIn,
  onOpenEmailAuth,
  onSignOut,
  onLoadRecord,
  onDeleteRecord,
}: VaultSidebarProps) {
  return (
    <aside className="vault-aside" aria-labelledby="vault-sidebar-heading">
      <div className="card">
        <div className="vault-title-row">
          <Vault size={20} aria-hidden="true" />
          <h2 id="vault-sidebar-heading">De-Identified Vault</h2>
        </div>
        <p className="vault-desc">
          Stores only scrubbed clinical summaries with local offline persistence — never raw
          identifiable documents.
        </p>

        {!user ? (
          <div className="vault-auth-box">
            <button
              type="button"
              className="btn-primary btn-full"
              onClick={onGuestSignIn}
              disabled={authBusy}
            >
              <UserCheck size={16} aria-hidden="true" />
              <span>{authBusy ? "Starting Session..." : "Continue as Guest"}</span>
            </button>
            <button
              type="button"
              className="btn-secondary btn-full"
              onClick={onOpenEmailAuth}
              disabled={authBusy}
            >
              <LogIn size={16} aria-hidden="true" />
              <span>Email &amp; Password Sign-In</span>
            </button>
          </div>
        ) : (
          <div className="vault-session-box">
            <div className="session-pill">
              <span className="session-label">
                {user.isAnonymous ? "Guest Vault Active" : user.email || "Signed In"}
              </span>
              <button
                type="button"
                className="btn-link"
                onClick={onSignOut}
                aria-label="Sign out of vault"
              >
                <LogOut size={14} aria-hidden="true" />
                <span>Sign Out</span>
              </button>
            </div>

            {user.isAnonymous && (
              <button
                type="button"
                className="btn-secondary btn-full"
                onClick={onOpenEmailAuth}
              >
                <LogIn size={15} aria-hidden="true" />
                <span>Switch to Email Sign-In</span>
              </button>
            )}
          </div>
        )}

        {authError && (
          <p className="alert-error" role="alert">
            {authError}
          </p>
        )}

        <div className="vault-records-block">
          <h3>Saved Summaries ({records.length})</h3>
          {records.length === 0 ? (
            <p className="empty-hint">
              {user
                ? "No saved de-identified summaries yet. Run Stage 1 and click Save De-Identified Summary."
                : "Sign in or continue as guest to save and compare de-identified visits offline."}
            </p>
          ) : (
            <ul className="vault-list">
              {records.map((rec) => (
                <li
                  key={rec.id}
                  className={`vault-item ${activeRecordId === rec.id ? "active" : ""}`}
                >
                  <button
                    type="button"
                    className="vault-item-main"
                    onClick={() => onLoadRecord(rec)}
                  >
                    <span className="vault-item-title">{rec.title}</span>
                    <span className="vault-item-meta">
                      {new Date(rec.updatedAtMs).toLocaleDateString()} &bull; {rec.redactionCount}{" "}
                      scrubbed &bull; {rec.stage1Source}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => onDeleteRecord(rec.id)}
                    aria-label={`Delete ${rec.title}`}
                  >
                    <Trash2 size={15} aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </aside>
  );
}
