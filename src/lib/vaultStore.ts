import {
  addDoc,
  collection,
  deleteDoc,
  doc,
  onSnapshot,
  orderBy,
  query,
  serverTimestamp,
  Timestamp,
  updateDoc,
  type Unsubscribe,
} from "firebase/firestore";
import { db } from "./firebase";
import type { InferenceSource, KeyFinding, Stage1Result, VaultRecord } from "../types";

function clampStr(value: string, maxLen: number): string {
  return value.trim().slice(0, maxLen);
}

function sanitizeFindings(findings: KeyFinding[]): KeyFinding[] {
  return findings.slice(0, 30).map((f) => ({
    item: clampStr(f.item || "Finding", 120),
    value: clampStr(f.value || "-", 120),
    status: f.status || "info",
    note: clampStr(f.note || "", 240),
  }));
}

export function subscribeVaultRecords(
  uid: string,
  onChange: (records: VaultRecord[]) => void,
  onError: (msg: string) => void
): Unsubscribe {
  const colRef = collection(db, "users", uid, "vaultRecords");
  const q = query(colRef, orderBy("updatedAt", "desc"));
  return onSnapshot(
    q,
    { includeMetadataChanges: true },
    (snap) => {
      const next: VaultRecord[] = snap.docs.map((d) => {
        const data = d.data();
        const createdTs = data.createdAt instanceof Timestamp ? data.createdAt.toMillis() : Date.now();
        const updatedTs = data.updatedAt instanceof Timestamp ? data.updatedAt.toMillis() : createdTs;
        return {
          id: d.id,
          uid: String(data.uid || uid),
          title: String(data.title || "Untitled Record"),
          documentType: data.documentType || "clinical_note",
          urgencyLevel: data.urgencyLevel || "routine",
          redactedText: String(data.redactedText || ""),
          redactedCategories: Array.isArray(data.redactedCategories) ? data.redactedCategories : [],
          redactionCount: typeof data.redactionCount === "number" ? data.redactionCount : 0,
          plainLanguageSummary: String(data.plainLanguageSummary || ""),
          keyFindings: Array.isArray(data.keyFindings) ? data.keyFindings : [],
          actionChecklist: Array.isArray(data.actionChecklist) ? data.actionChecklist : [],
          cloudSynthesis: String(data.cloudSynthesis || ""),
          stage1Source: data.stage1Source === "IN_CLOUD" ? "IN_CLOUD" : "ON_DEVICE",
          stage2Source:
            data.stage2Source === "IN_CLOUD" || data.stage2Source === "ON_DEVICE"
              ? data.stage2Source
              : "NONE",
          createdAtMs: createdTs,
          updatedAtMs: updatedTs,
        };
      });
      onChange(next);
    },
    (err) => {
      onError(err.message || "Unable to load saved vault summaries.");
    }
  );
}

export async function saveVaultRecord(params: {
  uid: string;
  stage1: Stage1Result;
  cloudSynthesis: string;
  stage2Source: "NONE" | InferenceSource;
  existingRecordId?: string | null;
}): Promise<string> {
  const { uid, stage1, cloudSynthesis, stage2Source, existingRecordId } = params;
  const nowPayload = {
    uid,
    title: clampStr(stage1.title || "De-Identified Summary", 160),
    documentType: stage1.documentType,
    urgencyLevel: stage1.urgencyLevel,
    redactedText: clampStr(stage1.redactedText || "[REDACTED DOCUMENT]", 12000),
    redactedCategories: stage1.redactedCategories.slice(0, 20).map((c) => clampStr(c, 40)),
    redactionCount: Math.max(0, Math.min(500, Math.round(stage1.redactionCount))),
    plainLanguageSummary: clampStr(stage1.plainLanguageSummary, 2000),
    keyFindings: sanitizeFindings(stage1.keyFindings),
    actionChecklist: stage1.actionChecklist.slice(0, 20).map((s) => clampStr(s, 240)),
    cloudSynthesis: clampStr(cloudSynthesis, 12000),
    stage1Source: stage1.inferenceSource,
    stage2Source,
    updatedAt: serverTimestamp(),
  };

  if (existingRecordId) {
    const docRef = doc(db, "users", uid, "vaultRecords", existingRecordId);
    await updateDoc(docRef, nowPayload);
    return existingRecordId;
  }

  const colRef = collection(db, "users", uid, "vaultRecords");
  const created = await addDoc(colRef, {
    ...nowPayload,
    createdAt: serverTimestamp(),
  });
  return created.id;
}

export async function deleteVaultRecord(uid: string, recordId: string): Promise<void> {
  const docRef = doc(db, "users", uid, "vaultRecords", recordId);
  await deleteDoc(docRef);
}
