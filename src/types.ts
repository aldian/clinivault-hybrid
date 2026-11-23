export type DocumentType =
  | "lab_report"
  | "prescription"
  | "discharge_summary"
  | "clinical_note"
  | "photo_scan";

export type UrgencyLevel = "routine" | "follow_up_soon" | "urgent_review";

export type InferenceSource = "ON_DEVICE" | "IN_CLOUD";

export type FindingStatus = "normal" | "borderline" | "elevated" | "critical" | "info";

export interface KeyFinding {
  item: string;
  value: string;
  status: FindingStatus;
  note: string;
}

export interface Stage1Result {
  title: string;
  documentType: DocumentType;
  urgencyLevel: UrgencyLevel;
  redactedText: string;
  redactedCategories: string[];
  redactionCount: number;
  plainLanguageSummary: string;
  keyFindings: KeyFinding[];
  actionChecklist: string[];
  inferenceSource: InferenceSource;
  latencyMs: number;
  bytesSentToCloud: number;
}

export interface Stage2Result {
  markdownText: string;
  inferenceSource: InferenceSource;
  latencyMs: number;
  modelUsed: string;
}

export interface VaultRecord {
  id: string;
  uid: string;
  title: string;
  documentType: DocumentType;
  urgencyLevel: UrgencyLevel;
  redactedText: string;
  redactedCategories: string[];
  redactionCount: number;
  plainLanguageSummary: string;
  keyFindings: KeyFinding[];
  actionChecklist: string[];
  cloudSynthesis: string;
  stage1Source: InferenceSource;
  stage2Source: "NONE" | InferenceSource;
  createdAtMs: number;
  updatedAtMs: number;
}

export interface RemotePolicy {
  cloudModelName: string;
  fastCloudModelName: string;
  defaultTriageMode: "PREFER_ON_DEVICE" | "ONLY_ON_DEVICE";
  maxCloudOutputTokens: number;
  enableCloudSynthesis: boolean;
  source: "remote" | "default";
}

export interface OnDeviceModelState {
  status: "available" | "downloadable" | "downloading" | "unavailable" | "checking";
  reason: string;
  progressPct: number | null;
}
