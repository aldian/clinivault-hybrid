import { useCallback, useEffect, useState } from "react";
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  signInAnonymously,
  signInWithEmailAndPassword,
  signOut,
  type User,
} from "firebase/auth";
import {
  Activity,
  Cpu,
  Download,
  FileImage,
  Lock,
  RefreshCw,
  Shield,
  ShieldAlert,
  Trash2,
  Wifi,
  WifiOff,
} from "lucide-react";
import { auth, loadRemotePolicy } from "./lib/firebase";
import {
  checkOnDeviceAvailability,
  downloadOnDeviceModel,
  runStage1LocalTriage,
  runStage2CloudSynthesisStream,
} from "./lib/hybridAi";
import { SAMPLE_CASES, type SampleCase } from "./lib/sampleCases";
import { deleteVaultRecord, saveVaultRecord, subscribeVaultRecords } from "./lib/vaultStore";
import { AuthDialog } from "./components/AuthDialog";
import { RedactionProofPanel } from "./components/RedactionProofPanel";
import { Stage2SynthesisPanel } from "./components/Stage2SynthesisPanel";
import { VaultSidebar } from "./components/VaultSidebar";
import type {
  DocumentType,
  OnDeviceModelState,
  RemotePolicy,
  Stage1Result,
  Stage2Result,
  VaultRecord,
} from "./types";

const DEFAULT_POLICY: RemotePolicy = {
  cloudModelName: "gemini-3.5-flash-lite",
  fastCloudModelName: "gemini-3.5-flash-lite",
  defaultTriageMode: "PREFER_ON_DEVICE",
  maxCloudOutputTokens: 2048,
  enableCloudSynthesis: true,
  source: "default",
};

export default function App() {
  const [isOnline, setIsOnline] = useState<boolean>(
    typeof navigator !== "undefined" ? navigator.onLine : true
  );
  const [policy, setPolicy] = useState<RemotePolicy>(DEFAULT_POLICY);
  const [onDeviceState, setOnDeviceState] = useState<OnDeviceModelState>({
    status: "checking",
    reason: "Checking local on-device AI capability...",
    progressPct: null,
  });

  // Auth & Vault state
  const [user, setUser] = useState<User | null>(null);
  const [authBusy, setAuthBusy] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authDialogOpen, setAuthDialogOpen] = useState(false);
  const [vaultRecords, setVaultRecords] = useState<VaultRecord[]>([]);
  const [activeRecordId, setActiveRecordId] = useState<string | null>(null);
  const [selectedPriorIds, setSelectedPriorIds] = useState<string[]>([]);

  // Stage 1 Intake state
  const [documentType, setDocumentType] = useState<DocumentType>("lab_report");
  const [inputText, setInputText] = useState<string>(SAMPLE_CASES[0].sampleText);
  const [imageFile, setImageFile] = useState<File | null>(null);
  const [imagePreviewUrl, setImagePreviewUrl] = useState<string | null>(null);
  const [strictOnDevice, setStrictOnDevice] = useState<boolean>(false);

  // Stage 1 Output & Save state
  const [stage1Running, setStage1Running] = useState(false);
  const [stage1Error, setStage1Error] = useState<string | null>(null);
  const [stage1Result, setStage1Result] = useState<Stage1Result | null>(null);
  const [savingVault, setSavingVault] = useState(false);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Stage 2 Synthesis state
  const [stage2Running, setStage2Running] = useState(false);
  const [stage2Stream, setStage2Stream] = useState("");
  const [stage2Result, setStage2Result] = useState<Stage2Result | null>(null);
  const [stage2Error, setStage2Error] = useState<string | null>(null);

  const refreshDeviceStatus = useCallback(async (withImg: boolean) => {
    const next = await checkOnDeviceAvailability(withImg);
    setOnDeviceState((prev) =>
      prev.status === "downloading" ? prev : next
    );
  }, []);

  useEffect(() => {
    const onOnline = () => setIsOnline(true);
    const onOffline = () => setIsOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
    };
  }, []);

  useEffect(() => {
    loadRemotePolicy().then((loaded) => {
      setPolicy(loaded);
      setStrictOnDevice(loaded.defaultTriageMode === "ONLY_ON_DEVICE");
    });
    void refreshDeviceStatus(Boolean(imageFile));
  }, [imageFile, refreshDeviceStatus]);

  useEffect(() => {
    const unsub = onAuthStateChanged(auth, (nextUser) => {
      setUser(nextUser);
      setAuthError(null);
      if (!nextUser) {
        setVaultRecords([]);
      }
    });
    return unsub;
  }, []);

  useEffect(() => {
    if (!user) return;
    const unsub = subscribeVaultRecords(
      user.uid,
      (recs) => setVaultRecords(recs),
      (err) => setAuthError(err)
    );
    return unsub;
  }, [user]);

  useEffect(() => {
    return () => {
      if (imagePreviewUrl && imagePreviewUrl.startsWith("blob:")) {
        URL.revokeObjectURL(imagePreviewUrl);
      }
    };
  }, [imagePreviewUrl]);

  async function handleDownloadLocalModel() {
    setOnDeviceState({
      status: "downloading",
      reason: "Downloading local Gemini Nano model weights inside browser...",
      progressPct: 0,
    });
    try {
      await downloadOnDeviceModel(policy.fastCloudModelName, (pct) => {
        setOnDeviceState({
          status: "downloading",
          reason: `Downloading local Gemini Nano weights (${pct}%)...`,
          progressPct: pct,
        });
      });
      await refreshDeviceStatus(Boolean(imageFile));
    } catch (err) {
      setOnDeviceState({
        status: "unavailable",
        reason:
          err instanceof Error
            ? err.message
            : "Local model download unavailable in this browser; smart hybrid cloud fallback remains active.",
        progressPct: null,
      });
    }
  }

  async function handleSelectSample(sample: SampleCase) {
    setStage1Error(null);
    setStage2Error(null);
    setSaveError(null);
    setLastSavedAt(null);
    setActiveRecordId(null);
    setStage1Result(null);
    setStage2Result(null);
    setStage2Stream("");
    setDocumentType(sample.documentType);
    setInputText(sample.sampleText);

    if (sample.imageUrl) {
      setImagePreviewUrl(sample.imageUrl);
      try {
        const resp = await fetch(sample.imageUrl);
        const blob = await resp.blob();
        const file = new File([blob], "sample-prescription.png", {
          type: blob.type || "image/png",
        });
        setImageFile(file);
      } catch {
        setImageFile(null);
        setImagePreviewUrl(null);
      }
    } else {
      setImageFile(null);
      setImagePreviewUrl(null);
    }
  }

  function handleImageSelected(file: File | null) {
    setStage1Error(null);
    if (!file) {
      setImageFile(null);
      setImagePreviewUrl(null);
      return;
    }
    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setStage1Error("Please select a JPEG or PNG image for local multimodal extraction.");
      return;
    }
    setImageFile(file);
    setImagePreviewUrl(URL.createObjectURL(file));
    if (documentType === "lab_report") {
      setDocumentType("photo_scan");
    }
  }

  async function handleRunStage1() {
    setStage1Running(true);
    setStage1Error(null);
    setStage2Error(null);
    setSaveError(null);
    setLastSavedAt(null);
    setStage2Result(null);
    setStage2Stream("");
    setActiveRecordId(null);

    try {
      const result = await runStage1LocalTriage({
        text: inputText,
        imageFile,
        documentTypeHint: documentType,
        strictOnDevice,
        fastCloudModel: policy.fastCloudModelName,
      });
      setStage1Result(result);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      if (strictOnDevice && onDeviceState.status !== "available") {
        setStage1Error(
          `Strict On-Device mode prevented cloud fallback because local model status is "${onDeviceState.status}". Download the local browser model above or switch to Smart Hybrid Auto-Fallback.`
        );
      } else {
        setStage1Error(rawMsg || "Unable to complete Stage 1 triage.");
      }
    } finally {
      setStage1Running(false);
    }
  }

  async function handleRunStage2() {
    if (!stage1Result) return;
    setStage2Running(true);
    setStage2Error(null);
    setStage2Result(null);
    setStage2Stream("");

    try {
      const selectedPriors = vaultRecords.filter((r) => selectedPriorIds.includes(r.id));
      const res = await runStage2CloudSynthesisStream({
        redactedText: stage1Result.redactedText,
        documentType: stage1Result.documentType,
        urgencyLevel: stage1Result.urgencyLevel,
        priorRecords: selectedPriors,
        cloudModel: policy.cloudModelName,
        maxOutputTokens: policy.maxCloudOutputTokens,
        onChunk: (partial) => setStage2Stream(partial),
      });
      setStage2Result(res);
    } catch (err) {
      setStage2Error(
        err instanceof Error ? err.message : "Unable to stream Stage 2 synthesis."
      );
    } finally {
      setStage2Running(false);
    }
  }

  async function handleSaveToVault() {
    if (!user || !stage1Result) return;
    setSavingVault(true);
    setSaveError(null);
    try {
      const id = await saveVaultRecord({
        uid: user.uid,
        stage1: stage1Result,
        cloudSynthesis: stage2Result?.markdownText || "",
        stage2Source: stage2Result ? stage2Result.inferenceSource : "NONE",
        existingRecordId: activeRecordId,
      });
      setActiveRecordId(id);
      setLastSavedAt(Date.now());
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unable to save summary.");
    } finally {
      setSavingVault(false);
    }
  }

  function handleLoadRecord(rec: VaultRecord) {
    setActiveRecordId(rec.id);
    setLastSavedAt(null);
    setStage1Error(null);
    setStage2Error(null);
    setSaveError(null);
    setDocumentType(rec.documentType);
    setInputText(rec.redactedText);
    setImageFile(null);
    setImagePreviewUrl(null);
    setStage1Result({
      title: rec.title,
      documentType: rec.documentType,
      urgencyLevel: rec.urgencyLevel,
      redactedText: rec.redactedText,
      redactedCategories: rec.redactedCategories,
      redactionCount: rec.redactionCount,
      plainLanguageSummary: rec.plainLanguageSummary,
      keyFindings: rec.keyFindings,
      actionChecklist: rec.actionChecklist,
      inferenceSource: rec.stage1Source,
      latencyMs: 0,
      bytesSentToCloud: 0,
    });
    if (rec.cloudSynthesis) {
      setStage2Result({
        markdownText: rec.cloudSynthesis,
        inferenceSource: rec.stage2Source === "NONE" ? "IN_CLOUD" : rec.stage2Source,
        latencyMs: 0,
        modelUsed: rec.stage2Source === "ON_DEVICE" ? "Local On-Device" : policy.cloudModelName,
      });
    } else {
      setStage2Result(null);
      setStage2Stream("");
    }
  }

  async function handleGuestSignIn() {
    setAuthBusy(true);
    setAuthError(null);
    try {
      await signInAnonymously(auth);
    } catch (err) {
      setAuthError(err instanceof Error ? err.message : "Guest sign-in failed.");
    } finally {
      setAuthBusy(false);
    }
  }

  async function handleEmailAuth(email: string, password: string, mode: "signin" | "signup") {
    setAuthError(null);
    if (mode === "signin") {
      await signInWithEmailAndPassword(auth, email, password);
    } else {
      await createUserWithEmailAndPassword(auth, email, password);
    }
  }

  async function handleSignOut() {
    setAuthError(null);
    setLastSavedAt(null);
    await signOut(auth);
  }

  async function handleDeleteRecord(id: string) {
    if (!user) return;
    await deleteVaultRecord(user.uid, id);
    if (activeRecordId === id) {
      setActiveRecordId(null);
      setLastSavedAt(null);
    }
    setSelectedPriorIds((prev) => prev.filter((item) => item !== id));
  }

  const lastRunSource = stage2Result
    ? stage2Result.inferenceSource
    : stage1Result?.inferenceSource ?? null;
  const lastLatency = stage2Result ? stage2Result.latencyMs : stage1Result?.latencyMs ?? null;
  const lastBytesSent = stage1Result?.bytesSentToCloud ?? 0;

  return (
    <div className="app-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>

      <header className="top-header">
        <div className="header-inner">
          <div className="brand-block">
            <img src="/icon.svg" alt="" className="brand-logo" width={40} height={40} />
            <div>
              <h1>CliniVault Hybrid</h1>
              <p className="brand-tagline">
                Private on-device medical triage &amp; PII redaction before de-identified cloud
                prep
              </p>
            </div>
          </div>

          <div className="status-strip" aria-live="polite" aria-label="Runtime status telemetry">
            <span className={`pill ${isOnline ? "pill-neutral" : "pill-warn"}`}>
              {isOnline ? <Wifi size={14} aria-hidden="true" /> : <WifiOff size={14} aria-hidden="true" />}
              <span>{isOnline ? "Online" : "Offline Mode"}</span>
            </span>

            <span
              className={`pill ${
                onDeviceState.status === "available" ? "pill-local" : "pill-neutral"
              }`}
              title={onDeviceState.reason}
            >
              <Cpu size={14} aria-hidden="true" />
              <span>Local AI: {onDeviceState.status}</span>
            </span>

            {onDeviceState.status === "downloadable" && (
              <button
                type="button"
                className="btn-compact"
                onClick={handleDownloadLocalModel}
              >
                <Download size={14} aria-hidden="true" />
                <span>Download Local Model</span>
              </button>
            )}

            <button
              type="button"
              className="btn-icon-outline"
              onClick={() => refreshDeviceStatus(Boolean(imageFile))}
              aria-label="Refresh on-device AI status"
            >
              <RefreshCw size={14} aria-hidden="true" />
            </button>

            {lastRunSource && (
              <span
                className={`pill ${
                  lastRunSource === "ON_DEVICE" ? "pill-local" : "pill-cloud"
                }`}
              >
                <Activity size={14} aria-hidden="true" />
                <span>
                  {lastRunSource} {lastLatency ? `• ${lastLatency} ms` : ""} &bull; Stage 1 Cloud:{" "}
                  {lastBytesSent} B
                </span>
              </span>
            )}
          </div>
        </div>
      </header>

      <div className="workspace-grid">
        <main id="main-content" className="main-column" tabIndex={-1}>
          <section className="card" aria-labelledby="stage1-heading">
            <div className="card-header-row">
              <div>
                <h2 id="stage1-heading">Stage 1: Local Intake &amp; Privacy Shield</h2>
                <p className="card-subtitle">{onDeviceState.reason}</p>
              </div>
              <span className="pill pill-local">
                <Shield size={14} aria-hidden="true" />
                <span>Zero-Leak Architecture</span>
              </span>
            </div>

            <div className="samples-section">
              <span className="section-label">Load Synthetic Clinical Case:</span>
              <div className="samples-grid">
                {SAMPLE_CASES.map((sample) => (
                  <button
                    key={sample.id}
                    type="button"
                    className="sample-btn"
                    onClick={() => handleSelectSample(sample)}
                  >
                    <strong>{sample.label}</strong>
                    <span>{sample.shortDesc}</span>
                  </button>
                ))}
              </div>
            </div>

            <div className="form-controls-row">
              <div className="field-group">
                <label htmlFor="doc-type-select">Document Category</label>
                <select
                  id="doc-type-select"
                  value={documentType}
                  onChange={(e) => setDocumentType(e.target.value as DocumentType)}
                >
                  <option value="lab_report">Lab Report</option>
                  <option value="prescription">Prescription</option>
                  <option value="discharge_summary">Hospital Discharge Summary</option>
                  <option value="clinical_note">Clinical Visit Note</option>
                  <option value="photo_scan">Prescription / Lab Photo Scan</option>
                </select>
              </div>

              <div className="field-group">
                <label htmlFor="privacy-mode-toggle">Privacy Routing Policy</label>
                <select
                  id="privacy-mode-toggle"
                  value={strictOnDevice ? "strict" : "hybrid"}
                  onChange={(e) => setStrictOnDevice(e.target.value === "strict")}
                >
                  <option value="hybrid">Smart Hybrid (Prefer On-Device, Cloud Fallback)</option>
                  <option value="strict">Strict On-Device Only (0 Bytes Sent Guaranteed)</option>
                </select>
              </div>
            </div>

            <div className="field-group">
              <label htmlFor="clinical-input-text">
                Lab Results, Discharge Note, or Clinical Text (Processed Locally First)
              </label>
              <textarea
                id="clinical-input-text"
                rows={8}
                value={inputText}
                onChange={(e) => setInputText(e.target.value)}
                placeholder="Paste lab results, medication list, or clinical notes here..."
              />
            </div>

            <div className="upload-row">
              <div className="upload-controls">
                <label htmlFor="image-upload-input" className="btn-secondary upload-label">
                  <FileImage size={16} aria-hidden="true" />
                  <span>Attach Lab or Rx Photo (JPEG / PNG)</span>
                </label>
                <input
                  id="image-upload-input"
                  type="file"
                  accept="image/jpeg,image/png"
                  className="visually-hidden"
                  onChange={(e) => handleImageSelected(e.target.files?.[0] || null)}
                />
                {imageFile && (
                  <button
                    type="button"
                    className="btn-icon-danger"
                    onClick={() => handleImageSelected(null)}
                    aria-label="Remove attached image"
                  >
                    <Trash2 size={15} aria-hidden="true" />
                    <span>Remove Photo ({imageFile.name})</span>
                  </button>
                )}
              </div>

              {imagePreviewUrl && (
                <div className="image-preview-box">
                  <img
                    src={imagePreviewUrl}
                    alt="Attached clinical document preview"
                    className="image-preview"
                  />
                </div>
              )}
            </div>

            <div className="primary-action-row">
              <button
                type="button"
                className="btn-primary"
                onClick={handleRunStage1}
                disabled={stage1Running}
              >
                <Lock size={16} aria-hidden="true" />
                <span>
                  {stage1Running
                    ? "Running Stage 1 Local Triage..."
                    : "Run Private Triage & Redaction"}
                </span>
              </button>

              {strictOnDevice && (
                <span className="pill pill-warn">
                  <ShieldAlert size={14} aria-hidden="true" />
                  <span>Strict Lock: Blocks cloud calls during Stage 1</span>
                </span>
              )}
            </div>

            {stage1Error && (
              <p className="alert-error" role="alert">
                {stage1Error}
              </p>
            )}
          </section>

          {stage1Result && (
            <>
              <RedactionProofPanel
                originalInputText={inputText}
                stage1={stage1Result}
                onRedactedTextChange={(nextText) =>
                  setStage1Result((prev) => (prev ? { ...prev, redactedText: nextText } : prev))
                }
                onSaveToVault={handleSaveToVault}
                saving={savingVault}
                lastSavedAt={lastSavedAt}
                saveError={saveError}
                canSave={Boolean(user)}
              />

              <Stage2SynthesisPanel
                redactedText={stage1Result.redactedText}
                vaultRecords={vaultRecords.filter((r) => r.id !== activeRecordId)}
                selectedPriorIds={selectedPriorIds}
                onTogglePrior={(id) =>
                  setSelectedPriorIds((prev) =>
                    prev.includes(id) ? prev.filter((item) => item !== id) : [...prev, id]
                  )
                }
                policy={policy}
                isOnline={isOnline}
                running={stage2Running}
                streamText={stage2Stream}
                stage2Result={stage2Result}
                errorMsg={stage2Error}
                onRunStage2={handleRunStage2}
              />
            </>
          )}
        </main>

        <VaultSidebar
          user={user}
          authBusy={authBusy}
          authError={authError}
          records={vaultRecords}
          activeRecordId={activeRecordId}
          onGuestSignIn={handleGuestSignIn}
          onOpenEmailAuth={() => setAuthDialogOpen(true)}
          onSignOut={handleSignOut}
          onLoadRecord={handleLoadRecord}
          onDeleteRecord={handleDeleteRecord}
        />
      </div>

      <footer className="app-footer">
        <p>
          <strong>Educational Visit-Prep Tool Only:</strong> CliniVault Hybrid helps prepare
          structured questions for licensed healthcare professionals and is not a medical diagnostic
          device. Synthetic demo records are pre-loaded for evaluation.
        </p>
      </footer>

      <AuthDialog
        open={authDialogOpen}
        onClose={() => setAuthDialogOpen(false)}
        onEmailAuth={handleEmailAuth}
      />
    </div>
  );
}
