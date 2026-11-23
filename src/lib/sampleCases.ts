import type { DocumentType } from "../types";

export interface SampleCase {
  id: string;
  label: string;
  shortDesc: string;
  documentType: DocumentType;
  sampleText: string;
  imageUrl?: string;
}

export const SAMPLE_CASES: SampleCase[] = [
  {
    id: "lab-panel",
    label: "1. Comprehensive Metabolic & Lipid Lab",
    shortDesc: "Elevated HbA1c, eGFR trend, and rich synthetic patient identifiers",
    documentType: "lab_report",
    sampleText: `BAYSIDE DIAGNOSTIC LABORATORY - OUTPATIENT REPORT (CONFIDENTIAL)
Patient Name: Marcus Vance
DOB: 1969-08-19 | MRN: MRN-4491820-B | SSN: 123-45-6789
Phone: (415) 892-3314 | Email: marcus.vance.demo@example.org
Address: 742 Evergreen Terrace, Apt 4B, Daly City, CA 94014
Ordering Clinician: Dr. Priya Nair, MD (NPI: 1982736451)
Collection Date: 2026-11-18

LABORATORY RESULTS:
- HbA1c: 7.4 % (Reference: <5.7%, Target: <7.0%) [HIGH]
- Fasting Glucose: 148 mg/dL (Reference: 70-99 mg/dL) [HIGH]
- Serum Creatinine: 1.38 mg/dL (Reference: 0.74-1.35 mg/dL) [BORDERLINE HIGH]
- eGFR (CKD-EPI): 56 mL/min/1.73m2 (Prior 6 months ago: 64 mL/min/1.73m2) [LOW]
- Potassium (K+): 5.3 mmol/L (Reference: 3.5-5.1 mmol/L) [BORDERLINE HIGH]
- LDL Cholesterol: 138 mg/dL (Optimal: <100 mg/dL) [ELEVATED]
- Urine Albumin-to-Creatinine Ratio (uACR): 48 mg/g (Reference: <30 mg/g) [ELEVATED]

CLINICIAN NOTE:
Patient reports mild ankle swelling over 10 days and started taking ibuprofen 400 mg twice daily for knee soreness while continuing lisinopril 20 mg daily and metformin 1000 mg twice daily. Repeat renal panel ordered in 2 weeks.`
  },
  {
    id: "discharge-summary",
    label: "2. Hospital Discharge & Medication List",
    shortDesc: "Anticoagulation + NSAID overlap risk and urgent INR follow-up",
    documentType: "discharge_summary",
    sampleText: `ST. JUDE COMMUNITY MEDICAL CENTER - DISCHARGE INSTRUCTIONS
Patient: Elena Rostova | DOB: 1978-04-12 | Account #: 99012-HR
Emergency Contact: Viktor Rostov (+1 206-555-0194)
Home Address: 1840 Mercer St, Seattle, WA 98109
Attending Physician: Dr. Samuel Chen, DO
Admit Date: 2026-11-15 | Discharge Date: 2026-11-20

PRINCIPAL DIAGNOSIS: Acute Deep Vein Thrombosis (left popliteal vein), Paroxysmal Atrial Fibrillation.

MEDICATIONS AT DISCHARGE:
1. Warfarin Sodium 5 mg oral once daily (target INR 2.0-3.0; discharge INR: 1.7)
2. Metoprolol Succinate 50 mg oral once daily
3. Omeprazole 20 mg oral once daily
4. Ibuprofen 600 mg every 8 hours as needed for leg pain (NOTE: Patient was taking OTC aspirin 81 mg at home prior to admission)

FOLLOW-UP INSTRUCTIONS:
Schedule Anticoagulation Clinic INR lab check within 48 hours of discharge. Contact clinic immediately for nosebleeds, dark tarry stools, unusual bruising, or shortness of breath.`
  },
  {
    id: "rx-photo",
    label: "3. Prescription Bottle Photo (Multimodal)",
    shortDesc: "Synthetic pharmacy label image with PII + interaction risk",
    documentType: "photo_scan",
    imageUrl: "/samples/sample-prescription.png",
    sampleText: `Attached photo of active pharmacy prescription labels retrieved from medicine cabinet. Identify active medications, strength, dosing schedule, warnings, and verify that patient identity details shown on the label are scrubbed before cloud sync.`
  }
];
