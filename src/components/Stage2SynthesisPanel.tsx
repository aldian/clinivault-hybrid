import type { ReactNode } from "react";
import { Sparkles, WifiOff } from "lucide-react";
import type { RemotePolicy, Stage2Result, VaultRecord } from "../types";

interface Stage2SynthesisPanelProps {
  redactedText: string;
  vaultRecords: VaultRecord[];
  selectedPriorIds: string[];
  onTogglePrior: (id: string) => void;
  policy: RemotePolicy;
  isOnline: boolean;
  running: boolean;
  streamText: string;
  stage2Result: Stage2Result | null;
  errorMsg: string | null;
  onRunStage2: () => Promise<void>;
}

/**
 * Render safe inline bold formatting (**text**) without HTML injection.
 */
function renderInlineMarkdown(text: string): ReactNode[] {
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, idx) => {
    if (part.startsWith("**") && part.endsWith("**") && part.length > 4) {
      return <strong key={idx}>{part.slice(2, -2)}</strong>;
    }
    return part;
  });
}

/**
 * Pure React Markdown renderer for Stage 2 clinical visit-prep synthesis.
 * Supports headings (## / ###), unordered lists (- / *), ordered lists (1.),
 * bold spans (**...**), and paragraphs with zero dangerouslySetInnerHTML.
 */
function renderSynthesisMarkdown(markdown: string): ReactNode[] {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const blocks: ReactNode[] = [];
  let paragraphLines: string[] = [];
  let listType: "ul" | "ol" | null = null;
  let listItems: string[] = [];

  const flushParagraph = () => {
    if (paragraphLines.length === 0) return;
    const text = paragraphLines.join(" ").trim();
    if (text) {
      blocks.push(<p key={`p-${blocks.length}`}>{renderInlineMarkdown(text)}</p>);
    }
    paragraphLines = [];
  };

  const flushList = () => {
    if (!listType || listItems.length === 0) {
      listType = null;
      listItems = [];
      return;
    }
    const ListTag = listType;
    blocks.push(
      <ListTag key={`list-${blocks.length}`}>
        {listItems.map((item, idx) => (
          <li key={idx}>{renderInlineMarkdown(item)}</li>
        ))}
      </ListTag>
    );
    listType = null;
    listItems = [];
  };

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line) {
      flushParagraph();
      flushList();
      continue;
    }

    const headingMatch = line.match(/^#{2,4}\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      blocks.push(<h3 key={`h-${blocks.length}`}>{renderInlineMarkdown(headingMatch[1])}</h3>);
      continue;
    }

    const ulMatch = line.match(/^[-*]\s+(.+)$/);
    if (ulMatch) {
      flushParagraph();
      if (listType !== "ul") {
        flushList();
        listType = "ul";
      }
      listItems.push(ulMatch[1]);
      continue;
    }

    const olMatch = line.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      flushParagraph();
      if (listType !== "ol") {
        flushList();
        listType = "ol";
      }
      listItems.push(olMatch[1]);
      continue;
    }

    flushList();
    paragraphLines.push(line);
  }

  flushParagraph();
  flushList();
  return blocks;
}

export function Stage2SynthesisPanel({
  redactedText,
  vaultRecords,
  selectedPriorIds,
  onTogglePrior,
  policy,
  isOnline,
  running,
  streamText,
  stage2Result,
  errorMsg,
  onRunStage2,
}: Stage2SynthesisPanelProps) {
  const displayOutput = stage2Result?.markdownText || streamText;

  return (
    <section className="card" aria-labelledby="stage2-heading">
      <div className="card-header-row">
        <div>
          <h2 id="stage2-heading">Stage 2: Deep Care-Prep Synthesis (De-Identified Only)</h2>
          <p className="card-subtitle">
            Prioritizes cloud reasoning on scrubbed text and automatically falls back on-device if
            offline.
          </p>
        </div>
        <span className="pill pill-neutral">
          Remote Policy: {policy.cloudModelName} ({policy.source === "remote" ? "Live" : "Default"})
        </span>
      </div>

      {!isOnline && (
        <div className="offline-notice" role="status">
          <WifiOff size={16} aria-hidden="true" />
          <span>
            Browser is currently offline — Stage 2 will automatically fall back to your local
            on-device model when available.
          </span>
        </div>
      )}

      {vaultRecords.length > 0 && (
        <fieldset className="prior-fieldset">
          <legend>Optional: Include prior de-identified records for trend comparison</legend>
          <div className="prior-list">
            {vaultRecords.slice(0, 4).map((rec) => {
              const checked = selectedPriorIds.includes(rec.id);
              return (
                <label key={rec.id} className="prior-check-item" htmlFor={`prior-${rec.id}`}>
                  <input
                    id={`prior-${rec.id}`}
                    type="checkbox"
                    checked={checked}
                    onChange={() => onTogglePrior(rec.id)}
                  />
                  <span>
                    <strong>{rec.title}</strong> ({new Date(rec.createdAtMs).toLocaleDateString()})
                  </span>
                </label>
              );
            })}
          </div>
        </fieldset>
      )}

      <div className="stage2-actions">
        <button
          type="button"
          className="btn-primary"
          onClick={onRunStage2}
          disabled={running || !redactedText.trim() || !policy.enableCloudSynthesis}
        >
          <Sparkles size={17} aria-hidden="true" />
          <span>
            {running
              ? "Streaming Care-Prep Synthesis..."
              : "Stream Deep Care-Prep Synthesis"}
          </span>
        </button>

        {stage2Result && (
          <span
            className={`pill ${
              stage2Result.inferenceSource === "IN_CLOUD" ? "pill-cloud" : "pill-local"
            }`}
          >
            Executed: {stage2Result.inferenceSource} ({stage2Result.modelUsed}) &bull;{" "}
            {stage2Result.latencyMs} ms
          </span>
        )}
      </div>

      {errorMsg && (
        <p className="alert-error" role="alert">
          {errorMsg}
        </p>
      )}

      <div className="synthesis-output" aria-live="polite">
        {displayOutput ? (
          <div className="synthesis-rendered">{renderSynthesisMarkdown(displayOutput)}</div>
        ) : (
          <p className="empty-hint">
            Run Stage 2 after reviewing Stage 1 redaction to generate drug-lab interaction checks
            and 5 clinician visit questions strictly from the de-identified text.
          </p>
        )}
      </div>
    </section>
  );
}
