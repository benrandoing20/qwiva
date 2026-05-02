// v1: static suggestions per cadre.
// v1.1+: these will be replaced by LLM-generated suggestions
// based on the user's query history and recent activity.
// Replace SUGGESTIONS_BY_CADRE with a hook that fetches from
// the backend.

// Cadres match the values used in onboarding/verify.tsx:
// 'Medical Practitioner' | 'Clinical Officer' | 'Dental Practitioner' | 'Intern'

const INTERN_SUGGESTIONS: string[] = [
  // Dosing
  'Amoxicillin dosing — paeds <5y',
  // Emergency
  'DKA: fluid resuscitation in adults',
  // Obs/Gynae
  'MgSO₄ loading dose for severe pre-eclampsia',
  // Protocol
  'Adult sepsis: first-hour bundle',
];

const MEDICAL_PRACTITIONER_SUGGESTIONS: string[] = [
  // Cardiology
  'First-line antihypertensive in T2DM with proteinuria',
  // Infectious Disease
  'Empirical antibiotics for community-acquired pneumonia',
  // Cardiology
  'Statin choice in CKD stage 3-4',
  // HIV
  'PrEP eligibility and follow-up for HIV-negative adults',
];

const CLINICAL_OFFICER_SUGGESTIONS: string[] = [
  // Tropical
  'Adult malaria treatment — uncomplicated vs severe',
  // Infectious Disease
  'TB: when to start treatment in suspected HIV co-infection',
  // Paeds
  'Pneumonia in under-5s: KEPI antibiotic protocol',
  // Emergency
  'Severe anaemia: transfusion thresholds',
];

const DENTAL_PRACTITIONER_SUGGESTIONS: string[] = [
  // Cardiology
  'Antibiotic prophylaxis: when to give for endocarditis risk',
  // Paeds
  'Post-extraction pain control in children',
  // Oral Surgery
  'Bisphosphonate-related osteonecrosis: pre-op screening',
  // Obs
  'Local anesthetic dosing in pregnancy',
];

const FALLBACK_SUGGESTIONS: string[] = [
  // Updates
  "What's new in 2026 hypertension guidelines?",
  // Interactions
  'Drug interaction: warfarin and metronidazole',
  // Common
  'First-line antibiotic for adult cellulitis',
  // Paeds
  'Pediatric paracetamol dosing by weight',
];

export type Cadre =
  | 'Medical Practitioner'
  | 'Clinical Officer'
  | 'Dental Practitioner'
  | 'Intern';

const SUGGESTIONS_BY_CADRE: Record<Cadre, string[]> = {
  'Intern': INTERN_SUGGESTIONS,
  'Medical Practitioner': MEDICAL_PRACTITIONER_SUGGESTIONS,
  'Clinical Officer': CLINICAL_OFFICER_SUGGESTIONS,
  'Dental Practitioner': DENTAL_PRACTITIONER_SUGGESTIONS,
};

export function getSuggestionsForCadre(cadre: string | null | undefined): string[] {
  if (!cadre) return FALLBACK_SUGGESTIONS;
  if (cadre in SUGGESTIONS_BY_CADRE) {
    return SUGGESTIONS_BY_CADRE[cadre as Cadre];
  }
  return FALLBACK_SUGGESTIONS;
}
