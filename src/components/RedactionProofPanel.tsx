import { BookmarkCheck, CheckCircle2, Lock, Save, ShieldCheck } from "lucide-react";
import type { Stage1Result } from "../types";

interface RedactionProofPanelProps {
  originalInputText: string;
  stage1: Stage1Result;
  onRedactedTextChange: (nextText: string) => void;
  onSaveToVault: () => Promise<void>;
  saving: boolean;
  lastSavedAt: number | null;
  saveError: string | null;
  canSave: boolean;
}

const URGENCY_LABELS: Record<Stage1Result["urgencyLevel"], string> = {
  routine: "Routine Review",
  follow_up_soon: "Schedule Follow-Up Soon",
  urgent_review: "Urgent Clinician Review",
};

export function RedactionProofPanel({
  originalInputText,
  stage1,
  onRedactedTextChange,
  onSaveToVault,
  saving,
  lastSavedAt,
  saveError,
  canSave,
}: RedactionProofPanelProps) {
  return (
    <section className="card" aria-labelledby="triage-proof-heading">
      <div className="card-header-row">
        <div>
          <h2 id="triage-proof-heading">Stage 1 Result: Triage &amp; Privacy Redaction Proof</h2>
          <p className="card-subtitle">{stage1.title}</p>
        </div>

        <div className="badge-group">
          <span className={`pill pill-urgency-${stage1.urgencyLevel}`}>
            {URGENCY_LABELS[stage1.urgencyLevel]}
          </span>
          <span
            className={`pill ${
              stage1.inferenceSource === "ON_DEVICE" ? "pill-local" : "pill-cloud"
            }`}
          >
            {stage1.inferenceSource === "ON_DEVICE"
              ? `On-Device Local • 0 B Sent • ${stage1.latencyMs} ms`
              : `Cloud Fallback • ${stage1.bytesSentToCloud} B Sent • ${stage1.latencyMs} ms`}
          </span>
        </div>
      </div>

      <div className="proof-banner">
        <ShieldCheck size={18} aria-hidden="true" />
        <div>
          <strong>
            {stage1.redactionCount} sensitive identifier{stage1.redactionCount === 1 ? "" : "s"}{" "}
            scrubbed before any Stage 2 sync
          </strong>
          {stage1.redactedCategories.length > 0 && (
            <div className="chip-row" aria-label="Scrubbed identifier categories">
              {stage1.redactedCategories.map((cat) => (
                <span key={cat} className="cat-chip">
                  {cat}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="summary-box">
        <h3>Plain-Language Summary (De-Identified)</h3>
        <p>{stage1.plainLanguageSummary}</p>
      </div>

      <div className="split-compare">
        <div className="compare-pane">
          <div className="pane-head">
            <Lock size={15} aria-hidden="true" />
            <span>Original Input (Stays in Browser Memory Only)</span>
          </div>
          <pre className="compare-pre">{originalInputText || "(Multimodal image scan input)"}</pre>
        </div>

        <div className="compare-pane">
          <label htmlFor="redacted-safe-textarea" className="pane-head pane-head-safe">
            <CheckCircle2 size={15} aria-hidden="true" />
            <span>Scrubbed Safe Text (Only This Crosses to Cloud Synthesis / Vault)</span>
          </label>
          <textarea
            id="redacted-safe-textarea"
            className="safe-textarea"
            rows={7}
            value={stage1.redactedText}
            onChange={(e) => onRedactedTextChange(e.target.value)}
          />
        </div>
      </div>

      {stage1.keyFindings.length > 0 && (
        <div className="table-wrap">
          <table>
            <caption>Structured Clinical Observations Extracted Locally</caption>
            <thead>
              <tr>
                <th scope="col">Item</th>
                <th scope="col">Value</th>
                <th scope="col">Status</th>
                <th scope="col">Clinical Note</th>
              </tr>
            </thead>
            <tbody>
              {stage1.keyFindings.map((f, idx) => (
                <tr key={`${f.item}-${idx}`}>
                  <td>{f.item}</td>
                  <td className="mono-cell">{f.value}</td>
                  <td>
                    <span className={`pill pill-finding-${f.status}`}>{f.status}</span>
                  </td>
                  <td>{f.note || "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {stage1.actionChecklist.length > 0 && (
        <div className="checklist-box">
          <h3>Recommended Next Steps</h3>
          <ul>
            {stage1.actionChecklist.map((step, i) => (
              <li key={i}>{step}</li>
            ))}
          </ul>
        </div>
      )}

      <div className="panel-footer-actions">
        <button
          type="button"
          className="btn-secondary"
          onClick={onSaveToVault}
          disabled={saving || !canSave}
        >
          <Save size={16} aria-hidden="true" />
          <span>{saving ? "Saving De-Identified Summary..." : "Save De-Identified Summary"}</span>
        </button>

        {lastSavedAt !== null && (
          <span className="saved-indicator" role="status">
            <BookmarkCheck size={16} aria-hidden="true" />
            <span>
              De-identified summary saved at{" "}
              {new Date(lastSavedAt).toLocaleTimeString([], {
                hour: "2-digit",
                minute: "2-digit",
                second: "2-digit",
              })}
            </span>
          </span>
        )}

        {!canSave && (
          <span className="hint-inline">
            Use Guest Access or Email Sign-In in the Vault panel to store summaries across sessions.
          </span>
        )}
      </div>

      {saveError && (
        <p className="alert-error" role="alert">
          {saveError}
        </p>
      )}
    </section>
  );
}
