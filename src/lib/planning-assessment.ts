export type EffortRange = {
  minHours: number;
  maxHours: number;
};

export type ImplementationAssessment = {
  schemaVersion: 1;
  effort: EffortRange;
  difficulty: number;
  impact: number;
  risk: number;
  confidence: number;
  rationale: string;
  grounding: string[];
  requiredCapabilities: string[];
  constraints: string[];
  missingEvidence: string[];
  alternatives: string[];
};

function readStringArray(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.some((item) => typeof item !== "string")) return null;
  return value;
}

export function parseImplementationAssessment(value: unknown): ImplementationAssessment | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const record = value as Record<string, unknown>;
  const effort = record.effort;
  if (!effort || typeof effort !== "object" || Array.isArray(effort)) return undefined;
  const effortRecord = effort as Record<string, unknown>;
  const minHours = effortRecord.minHours;
  const maxHours = effortRecord.maxHours;
  if (
    record.schemaVersion !== 1
    || typeof minHours !== "number"
    || !Number.isFinite(minHours)
    || minHours < 0
    || typeof maxHours !== "number"
    || !Number.isFinite(maxHours)
    || maxHours < minHours
    || typeof record.rationale !== "string"
    || record.rationale.trim().length === 0
  ) {
    return undefined;
  }

  const ratings = [record.difficulty, record.impact, record.risk, record.confidence];
  if (ratings.some((rating) => typeof rating !== "number" || !Number.isInteger(rating) || rating < 1 || rating > 5)) {
    return undefined;
  }

  const grounding = readStringArray(record.grounding);
  const requiredCapabilities = readStringArray(record.requiredCapabilities);
  const constraints = readStringArray(record.constraints);
  const missingEvidence = readStringArray(record.missingEvidence);
  const alternatives = readStringArray(record.alternatives);
  if (!grounding || !requiredCapabilities || !constraints || !missingEvidence || !alternatives) return undefined;

  return {
    schemaVersion: 1,
    effort: { minHours, maxHours },
    difficulty: record.difficulty as number,
    impact: record.impact as number,
    risk: record.risk as number,
    confidence: record.confidence as number,
    rationale: record.rationale,
    grounding,
    requiredCapabilities,
    constraints,
    missingEvidence,
    alternatives,
  };
}

export type ParallelismGuidance = {
  maxParallelTasks: number;
  rationale: string;
};

export type PlanAssessment = {
  schemaVersion: 1;
  implementation: ImplementationAssessment;
  artifactFingerprint: string;
  sourceIdeaId?: string;
  estimateDrift: string;
  expectedContextTokens: number;
  parallelism: ParallelismGuidance;
  assessedAt: number;
  stale: boolean;
};
