interface RedactionRule {
  category: string;
  placeholder: string;
  pattern: RegExp;
}

const DETERMINISTIC_RULES: RedactionRule[] = [
  {
    category: "SSN",
    placeholder: "[REDACTED_SSN]",
    pattern: /\b\d{3}[-\s]?\d{2}[-\s]?\d{4}\b/g,
  },
  {
    category: "EMAIL",
    placeholder: "[REDACTED_EMAIL]",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  },
  {
    category: "PHONE",
    placeholder: "[REDACTED_PHONE]",
    pattern: /(?:\+?1[-.\s]?)?\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/g,
  },
  {
    category: "MRN / ACCOUNT",
    placeholder: "[REDACTED_ID]",
    pattern: /\b(?:MRN|Acct|Account\s*#|Account\s*ID|Rx\s*#|NPI)[:\s#-]*[A-Z0-9-]{4,}\b/gi,
  },
  {
    category: "DOB",
    placeholder: "[REDACTED_DOB]",
    pattern: /\b(?:DOB|Date of Birth|Birthdate)[:\s]*\d{2,4}[-/]\d{1,2}[-/]\d{2,4}\b/gi,
  },
  {
    category: "PATIENT / CONTACT NAME",
    placeholder: "[REDACTED_NAME]",
    pattern: /\b(?:Patient Name|Patient|Emergency Contact)[:\s]+[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}/g,
  },
  {
    category: "ADDRESS",
    placeholder: "[REDACTED_ADDRESS]",
    pattern: /\b(?:Home Address|Address)[:\s]+[^\n]+/gi,
  },
  {
    category: "CLINICIAN NAME",
    placeholder: "[REDACTED_CLINICIAN]",
    pattern: /\b(?:Dr\.?\s+[A-Z][a-z]+(?:\s+[A-Z][a-z]+)?(?:,\s*(?:MD|DO|NP|PA))?)/g,
  },
];

export interface RedactionCheckResult {
  scrubbedText: string;
  categories: string[];
  totalReplacements: number;
}

/**
 * Enforce deterministic local PII scrubbing as a defense-in-depth safety net
 * on top of Gemini Nano 4 on-device structured redaction.
 */
const CANONICAL_ACRONYMS = new Set(["DOB", "MRN", "SSN", "NPI", "ID"]);

function normalizeCategoryLabel(raw: string): string {
  const cleaned = raw.trim().replace(/\s+/g, " ");
  if (!cleaned) return "";
  const lower = cleaned.toLowerCase();
  if (lower === "patient / contact name" || lower === "patient name" || lower === "name") {
    return "Patient Name";
  }
  const upper = cleaned.toUpperCase();
  if (CANONICAL_ACRONYMS.has(upper)) {
    return upper;
  }
  if (cleaned === upper) {
    return lower.replace(/\b\w/g, (ch) => ch.toUpperCase());
  }
  return cleaned;
}

export function enforceDeterministicRedaction(
  modelRedactedText: string,
  modelCategories: string[] = []
): RedactionCheckResult {
  let scrubbed = modelRedactedText;
  const categoryMap = new Map<string, string>();
  const addCategory = (raw: string, overwrite = false) => {
    const normalized = normalizeCategoryLabel(raw);
    if (!normalized) return;
    const key = normalized.toLowerCase();
    if (overwrite || !categoryMap.has(key)) {
      categoryMap.set(key, normalized);
    }
  };

  for (const cat of modelCategories) {
    if (typeof cat === "string") {
      addCategory(cat);
    }
  }
  let totalReplacements = 0;

  for (const rule of DETERMINISTIC_RULES) {
    scrubbed = scrubbed.replace(rule.pattern, () => {
      addCategory(rule.category, true);
      totalReplacements += 1;
      return rule.placeholder;
    });
  }

  const existingPlaceholders = scrubbed.match(/\[REDACTED_[A-Z_]+\]/g) || [];
  const uniquePlaceholderCount = Math.max(totalReplacements, existingPlaceholders.length);

  return {
    scrubbedText: scrubbed.trim(),
    categories: Array.from(categoryMap.values()).slice(0, 20),
    totalReplacements: Math.min(500, uniquePlaceholderCount),
  };
}
