import {
  getGenerativeModel,
  InferenceMode,
  Schema,
  type GenerateContentResult,
  type InlineDataPart,
  type LanguageModelExpected,
  type Part,
} from "firebase/ai";
import { ai } from "./firebase";
import { enforceDeterministicRedaction } from "./redaction";
import type {
  DocumentType,
  FindingStatus,
  InferenceSource,
  KeyFinding,
  OnDeviceModelState,
  Stage1Result,
  Stage2Result,
  UrgencyLevel,
  VaultRecord,
} from "../types";

interface ChromeLanguageModelGlobal {
  availability: (opts?: {
    expectedInputs?: LanguageModelExpected[];
    expectedOutputs?: LanguageModelExpected[];
  }) => Promise<"available" | "downloadable" | "downloading" | "unavailable">;
  create: (opts?: {
    expectedInputs?: LanguageModelExpected[];
    expectedOutputs?: LanguageModelExpected[];
    monitor?: (monitor: {
      addEventListener: (type: "downloadprogress", cb: (e: { loaded: number }) => void) => void;
    }) => void;
  }) => Promise<{ destroy?: () => void }>;
}

function getGlobalLanguageModel(): ChromeLanguageModelGlobal | null {
  const g = globalThis as unknown as { LanguageModel?: ChromeLanguageModelGlobal };
  return g.LanguageModel ?? null;
}

const triageSchema = Schema.object({
  properties: {
    title: Schema.string({
      description: "Short de-identified clinical record title (3 to 8 words, no personal names).",
    }),
    documentType: Schema.enumString({
      enum: ["lab_report", "prescription", "discharge_summary", "clinical_note", "photo_scan"],
    }),
    urgencyLevel: Schema.enumString({
      enum: ["routine", "follow_up_soon", "urgent_review"],
    }),
    redactedText: Schema.string({
      description:
        "Full medical text transcribed from input/image with ALL personal identifiers replaced by [REDACTED_NAME], [REDACTED_DOB], [REDACTED_PHONE], [REDACTED_EMAIL], [REDACTED_ID], [REDACTED_ADDRESS], or [REDACTED_CLINICIAN].",
    }),
    redactedCategories: Schema.array({
      items: Schema.string(),
    }),
    plainLanguageSummary: Schema.string({
      description: "2-3 sentence de-identified patient-friendly summary of what the document shows.",
    }),
    keyFindings: Schema.array({
      items: Schema.object({
        properties: {
          item: Schema.string(),
          value: Schema.string(),
          status: Schema.enumString({
            enum: ["normal", "borderline", "elevated", "critical", "info"],
          }),
          note: Schema.string(),
        },
      }),
    }),
    actionChecklist: Schema.array({
      items: Schema.string(),
    }),
  },
});

const STAGE1_SYSTEM_PROMPT = `You are CliniVault Local Privacy Shield running on the user's device.
Read the medical note or prescription/lab image and return structured JSON matching the schema:
1. Scrub EVERY personal identifier (patient name, contact names, dates of birth, phone numbers, emails, street addresses, SSN, MRN/account numbers, prescription numbers, clinician names, NPI) inside "redactedText" using tags like [REDACTED_NAME], [REDACTED_DOB], [REDACTED_PHONE], [REDACTED_EMAIL], [REDACTED_ID], [REDACTED_ADDRESS], [REDACTED_CLINICIAN].
2. Keep all medications, dosages, lab analytes, units, reference ranges, symptoms, and instructions intact inside "redactedText".
3. Classify urgency conservatively ("urgent_review" for acute anticoagulation/bleeding risks, severe hyperkalemia, discharge INR mismatches, or critical flags; "follow_up_soon" for elevated glycemic/renal trends; "routine" otherwise).
4. Never copy any patient name or personal identifier into "title", "plainLanguageSummary", "keyFindings", or "actionChecklist".`;

const STAGE2_SYSTEM_PROMPT = `You are a careful clinical visit-preparation assistant analyzing ONLY de-identified summaries.
Never ask for personal identity details. Keep the total response concise and scannable (~450-550 words) organized under these clean Markdown headings:
## 1. Key Trends & Interactions to Discuss
## 2. Top 5 Questions for Your Clinician
## 3. Longitudinal Notes & Follow-Up Timing
Include a brief reminder that this output prepares questions for a licensed clinician and does not replace medical diagnosis.`;

export async function checkOnDeviceAvailability(
  withImage = false
): Promise<OnDeviceModelState> {
  const lm = getGlobalLanguageModel();
  if (!lm || typeof lm.availability !== "function") {
    return {
      status: "unavailable",
      reason: "Desktop Chrome 139+ Prompt API is not enabled in this browser.",
      progressPct: null,
    };
  }
  try {
    const expectedInputs: LanguageModelExpected[] = withImage
      ? [
          { type: "text", languages: ["en"] },
          { type: "image" },
        ]
      : [{ type: "text", languages: ["en"] }];
    const avail = await lm.availability({
      expectedInputs,
      expectedOutputs: [{ type: "text", languages: ["en"] }],
    });
    const reasonMap: Record<string, string> = {
      available: "Local on-device Gemini Nano model is downloaded and ready (0 bytes sent to cloud).",
      downloadable: "Browser supports on-device Gemini Nano; click Download Local Model to warm it up.",
      downloading: "Downloading local Gemini Nano weights inside Chrome...",
      unavailable: "Hardware or Chrome Prompt API flags are unavailable on this browser; cloud fallback active.",
    };
    return {
      status: avail,
      reason: reasonMap[avail] || "Checking on-device model status.",
      progressPct: avail === "available" ? 100 : null,
    };
  } catch (err) {
    return {
      status: "unavailable",
      reason: err instanceof Error ? err.message : "On-device check unavailable.",
      progressPct: null,
    };
  }
}

export async function downloadOnDeviceModel(
  fastCloudModel: string,
  onProgress: (pct: number) => void
): Promise<void> {
  const model = getGenerativeModel(ai, {
    mode: InferenceMode.PREFER_ON_DEVICE,
    inCloudParams: { model: fastCloudModel },
    onDeviceParams: {
      createOptions: {
        expectedInputs: [{ type: "text", languages: ["en"] }, { type: "image" }],
        expectedOutputs: [{ type: "text", languages: ["en"] }],
      },
    },
  });

  if (typeof model.initializeDeviceModel === "function") {
    await model.initializeDeviceModel((progress) => {
      onProgress(Math.max(0, Math.min(100, Math.round(progress * 100))));
    });
    return;
  }

  const lm = getGlobalLanguageModel();
  if (!lm) {
    throw new Error("On-device Prompt API is unavailable in this browser.");
  }
  const session = await lm.create({
    expectedInputs: [{ type: "text", languages: ["en"] }],
    expectedOutputs: [{ type: "text", languages: ["en"] }],
    monitor(m) {
      m.addEventListener("downloadprogress", (e) => {
        onProgress(Math.max(0, Math.min(100, Math.round(e.loaded * 100))));
      });
    },
  });
  session.destroy?.();
}

async function fileToInlinePart(file: File): Promise<InlineDataPart> {
  const base64Data = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onloadend = () => {
      const result = String(reader.result || "");
      const commaIdx = result.indexOf(",");
      if (commaIdx < 0) {
        reject(new Error("Could not encode selected image."));
        return;
      }
      resolve(result.slice(commaIdx + 1));
    };
    reader.onerror = () => reject(new Error("Unable to read selected image file."));
    reader.readAsDataURL(file);
  });

  return {
    type: "inlineData",
    inlineData: {
      data: base64Data,
      mimeType: file.type || "image/png",
    },
  };
}

function parseJsonResponse(rawText: string): Record<string, unknown> {
  const trimmed = rawText.trim();
  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fencedMatch ? fencedMatch[1].trim() : trimmed;
  try {
    return JSON.parse(candidate) as Record<string, unknown>;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start >= 0 && end > start) {
      return JSON.parse(candidate.slice(start, end + 1)) as Record<string, unknown>;
    }
    throw new Error("Model output was not valid structured JSON.");
  }
}

function normalizeDocType(value: unknown, fallback: DocumentType): DocumentType {
  const allowed: DocumentType[] = [
    "lab_report",
    "prescription",
    "discharge_summary",
    "clinical_note",
    "photo_scan",
  ];
  return typeof value === "string" && allowed.includes(value as DocumentType)
    ? (value as DocumentType)
    : fallback;
}

function normalizeUrgency(value: unknown): UrgencyLevel {
  if (value === "urgent_review" || value === "follow_up_soon" || value === "routine") {
    return value;
  }
  return "follow_up_soon";
}

function normalizeFindings(value: unknown): KeyFinding[] {
  if (!Array.isArray(value)) return [];
  const statuses: FindingStatus[] = ["normal", "borderline", "elevated", "critical", "info"];
  return value
    .filter((item): item is Record<string, unknown> => Boolean(item && typeof item === "object"))
    .slice(0, 30)
    .map((f) => ({
      item: String(f.item || "Observation").slice(0, 120),
      value: String(f.value || "-").slice(0, 120),
      status: statuses.includes(f.status as FindingStatus)
        ? (f.status as FindingStatus)
        : "info",
      note: String(f.note || "").slice(0, 240),
    }));
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> {
  void promise.catch(() => undefined);
  let timerId: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          reject(new Error(`${label} timeout (temporarily unavailable)`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timerId !== undefined) clearTimeout(timerId);
  }
}

async function consumeStreamWithTimeout(
  stream: AsyncIterable<{ text: () => string }>,
  chunkTimeoutMs: number,
  onChunk: (accumulated: string) => void
): Promise<string> {
  const iterator = stream[Symbol.asyncIterator]();
  let accumulated = "";

  try {
    while (true) {
      const nextPromise = iterator.next();
      void nextPromise.catch(() => undefined);
      let timerId: ReturnType<typeof setTimeout> | undefined;
      const timeoutPromise = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => {
          reject(new Error("Stream inactivity timeout (parse-failed)"));
        }, chunkTimeoutMs);
      });

      let step: IteratorResult<{ text: () => string }>;
      try {
        step = await Promise.race([nextPromise, timeoutPromise]);
      } finally {
        if (timerId !== undefined) clearTimeout(timerId);
      }

      if (step.done) {
        break;
      }
      const piece = step.value.text();
      if (piece) {
        accumulated += piece;
        onChunk(accumulated);
      }
    }
  } catch (err) {
    void Promise.resolve(iterator.return?.()).catch(() => undefined);
    throw err;
  }

  return accumulated;
}

function isStreamParseError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return /parse-failed|Failed to parse stream|empty synthesis response/i.test(msg);
}

function isTransientModelError(err: unknown): boolean {
  const msg = err instanceof Error ? err.message : String(err);
  return (
    isStreamParseError(err) ||
    /\[500\s*\]|\[503\s*\]|high demand|temporarily unavailable|resource_exhausted/i.test(msg)
  );
}

function buildFallbackModelList(primary: string): string[] {
  const uniqueTail = Array.from(
    new Set([primary, "gemini-4-hydrogen", "gemini-3.8-flash"])
  );
  return [primary, ...uniqueTail];
}

function extractInferenceSource(result: GenerateContentResult): InferenceSource {
  const src = result.response.inferenceSource;
  return src === "on_device" ? "ON_DEVICE" : "IN_CLOUD";
}

export async function runStage1LocalTriage(params: {
  text: string;
  imageFile: File | null;
  documentTypeHint: DocumentType;
  strictOnDevice: boolean;
  fastCloudModel: string;
}): Promise<Stage1Result> {
  const { text, imageFile, documentTypeHint, strictOnDevice, fastCloudModel } = params;
  const trimmedText = text.trim();
  if (!trimmedText && !imageFile) {
    throw new Error("Enter clinical text or attach a lab/prescription JPEG or PNG first.");
  }

  const expectedInputs: LanguageModelExpected[] = imageFile
    ? [
        { type: "text", languages: ["en"] },
        { type: "image" },
      ]
    : [{ type: "text", languages: ["en"] }];

  const mode = strictOnDevice ? InferenceMode.ONLY_ON_DEVICE : InferenceMode.PREFER_ON_DEVICE;
  const candidateModels = strictOnDevice ? [fastCloudModel] : buildFallbackModelList(fastCloudModel);

  const userPrompt = `Analyze this clinical record (document hint: ${documentTypeHint}). Transcribe any attached image text and scrub ALL personal identifiers before outputting JSON.\n\nINPUT TEXT:\n${trimmedText || "(See attached image)"}`;
  const parts: Array<string | Part> = [userPrompt];
  let imageBytes = 0;

  if (imageFile) {
    const imgPart = await fileToInlinePart(imageFile);
    parts.push(imgPart);
    imageBytes = imgPart.inlineData.data.length;
  }

  let result: GenerateContentResult | null = null;
  let lastErr: unknown = null;
  const startedAt = performance.now();

  for (let idx = 0; idx < candidateModels.length; idx += 1) {
    const modelName = candidateModels[idx];
    if (idx > 0) {
      await sleep(1200);
    }
    const attemptMode = !strictOnDevice && idx > 0 ? InferenceMode.ONLY_IN_CLOUD : mode;
    const model = getGenerativeModel(ai, {
      mode: attemptMode,
      inCloudParams: {
        model: modelName,
        systemInstruction: STAGE1_SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.1,
          maxOutputTokens: 2048,
          responseMimeType: "application/json",
          responseSchema: triageSchema,
        },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs,
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: STAGE1_SYSTEM_PROMPT }],
            },
          ],
        },
        promptOptions: {
          responseConstraint: triageSchema,
        },
      },
    });

    try {
      result = await model.generateContent(parts);
      break;
    } catch (err) {
      lastErr = err;
      if (strictOnDevice || !isTransientModelError(err)) {
        throw err;
      }
    }
  }

  if (!result) {
    throw lastErr instanceof Error ? lastErr : new Error("Stage 1 inference failed.");
  }

  const latencyMs = Math.round(performance.now() - startedAt);
  const inferenceSource = extractInferenceSource(result);
  const parsed = parseJsonResponse(result.response.text());

  const candidateRedacted = String(parsed.redactedText || trimmedText || "[IMAGE_TRANSCRIBED]");
  const modelCategories = Array.isArray(parsed.redactedCategories)
    ? parsed.redactedCategories.map((c) => String(c))
    : [];

  // Run deterministic privacy safety-net locally even after model redaction
  const enforced = enforceDeterministicRedaction(candidateRedacted, modelCategories);
  const safeTitle = enforceDeterministicRedaction(
    String(parsed.title || "Clinical Triage Summary")
  ).scrubbedText.slice(0, 160);
  const safeSummary = enforceDeterministicRedaction(
    String(parsed.plainLanguageSummary || "Structured findings extracted with identifiers removed.")
  ).scrubbedText.slice(0, 2000);
  const safeChecklist = Array.isArray(parsed.actionChecklist)
    ? parsed.actionChecklist
        .slice(0, 20)
        .map((item) => enforceDeterministicRedaction(String(item)).scrubbedText.slice(0, 240))
    : [];

  return {
    title: safeTitle,
    documentType: normalizeDocType(parsed.documentType, documentTypeHint),
    urgencyLevel: normalizeUrgency(parsed.urgencyLevel),
    redactedText: enforced.scrubbedText.slice(0, 12000),
    redactedCategories: enforced.categories,
    redactionCount: enforced.totalReplacements,
    plainLanguageSummary: safeSummary,
    keyFindings: normalizeFindings(parsed.keyFindings),
    actionChecklist: safeChecklist,
    inferenceSource,
    latencyMs,
    bytesSentToCloud:
      inferenceSource === "ON_DEVICE" ? 0 : new TextEncoder().encode(userPrompt).length + imageBytes,
  };
}

export async function runStage2CloudSynthesisStream(params: {
  redactedText: string;
  documentType: DocumentType;
  urgencyLevel: UrgencyLevel;
  priorRecords: Pick<VaultRecord, "title" | "documentType" | "urgencyLevel" | "plainLanguageSummary" | "createdAtMs">[];
  cloudModel: string;
  maxOutputTokens: number;
  onChunk: (partialMarkdown: string) => void;
}): Promise<Stage2Result> {
  const {
    redactedText,
    documentType,
    urgencyLevel,
    priorRecords,
    cloudModel,
    maxOutputTokens,
    onChunk,
  } = params;

  // Enforce privacy boundary in code: always run deterministic redaction right before cloud transmission
  const verifiedCleanText = enforceDeterministicRedaction(redactedText).scrubbedText;
  const historyBlock =
    priorRecords.length > 0
      ? priorRecords
          .slice(0, 4)
          .map(
            (r, idx) =>
              `- Prior Record ${idx + 1} (${new Date(r.createdAtMs).toISOString().slice(0, 10)}, ${r.documentType}, ${r.urgencyLevel}): ${r.title} — ${r.plainLanguageSummary}`
          )
          .join("\n")
      : "No prior de-identified records selected.";

  const prompt = `CURRENT DE-IDENTIFIED RECORD (${documentType}, urgency: ${urgencyLevel}):
${verifiedCleanText}

DE-IDENTIFIED HISTORICAL CONTEXT:
${historyBlock}

Provide a clear, practical visit-preparation brief covering interactions, abnormal trends, and specific questions to ask the clinician.`;

  const candidateModels = buildFallbackModelList(cloudModel);
  const startedAt = performance.now();
  let lastErr: unknown = null;

  for (let idx = 0; idx < candidateModels.length; idx += 1) {
    const modelName = candidateModels[idx];
    if (idx > 0) {
      await sleep(1200);
    }
    const attemptMode = idx > 0 ? InferenceMode.ONLY_IN_CLOUD : InferenceMode.PREFER_IN_CLOUD;
    const model = getGenerativeModel(ai, {
      mode: attemptMode,
      inCloudParams: {
        model: modelName,
        systemInstruction: STAGE2_SYSTEM_PROMPT,
        generationConfig: {
          temperature: 0.3,
          maxOutputTokens,
        },
      },
      onDeviceParams: {
        createOptions: {
          expectedInputs: [{ type: "text", languages: ["en"] }],
          expectedOutputs: [{ type: "text", languages: ["en"] }],
          initialPrompts: [
            {
              role: "system",
              content: [{ type: "text", value: STAGE2_SYSTEM_PROMPT }],
            },
          ],
        },
      },
    });

    const formatStage2Result = (
      markdownText: string,
      rawSource: string | undefined
    ) => {
      const inferenceSource: InferenceSource =
        rawSource === "on_device" ? "ON_DEVICE" : "IN_CLOUD";
      return {
        markdownText,
        inferenceSource,
        latencyMs: Math.round(performance.now() - startedAt),
        modelUsed:
          inferenceSource === "IN_CLOUD"
            ? modelName
            : "Gemini Nano (On-Device Offline Fallback)",
      };
    };

    const isOffline = typeof navigator !== "undefined" && !navigator.onLine;
    const streamTimeoutMs = isOffline
      ? 45_000
      : modelName === "gemini-3.5-flash-lite"
        ? 12_000
        : 35_000;
    const fallbackTimeoutMs = isOffline
      ? 45_000
      : modelName === "gemini-3.5-flash-lite"
        ? 20_000
        : 40_000;

    try {
      let accumulated = "";
      try {
        const streamResult = await withTimeout(
          model.generateContentStream(prompt),
          streamTimeoutMs,
          "Stage 2 stream open"
        );
        const responsePromise = streamResult.response.catch(() => null);
        accumulated = await consumeStreamWithTimeout(
          streamResult.stream,
          streamTimeoutMs,
          (partial) => {
            accumulated = partial;
            onChunk(partial);
          }
        );
        const finalResponse = await responsePromise;
        const finalText = (accumulated || finalResponse?.text() || "").trim();
        if (!finalText) {
          throw new Error("Empty synthesis response from stream.");
        }
        return formatStage2Result(finalText, finalResponse?.inferenceSource);
      } catch (streamErr) {
        if (!isStreamParseError(streamErr)) {
          throw streamErr;
        }
        const fallbackResult = await withTimeout(
          model.generateContent(prompt),
          fallbackTimeoutMs,
          "Stage 2 non-stream fallback"
        );
        const fallbackText = (fallbackResult.response.text() || accumulated).trim();
        if (!fallbackText) {
          throw streamErr;
        }
        onChunk(fallbackText);
        return formatStage2Result(fallbackText, fallbackResult.response.inferenceSource);
      }
    } catch (err) {
      lastErr = err;
      if (!isTransientModelError(err)) {
        throw err;
      }
      onChunk("");
    }
  }

  throw lastErr instanceof Error ? lastErr : new Error("Stage 2 synthesis failed.");
}
