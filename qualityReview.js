import path from "node:path";
import { requestJson } from "./designWorkflow.js";
import { validateReview } from "./designContracts.js";
import { reviewPrompt } from "./prompts.js";

export function createQualityReviewer({ generate, brief, design, outDir }) {
  return async ({ code, attempt, validation }) => {
    const review = await requestJson({
      generate, outDir, label: `review-${attempt}`,
      prompt: reviewPrompt({ brief, design, code, validation }),
      validate: value => validateReview(value, design),
    });
    const errors = [
      ...review.requirements.filter(r => !r.met).map(r => `${r.id} missing: ${r.evidence}`),
      ...review.signatureMechanics.filter(m => !m.met).map(m => `${m.name} missing: ${m.evidence}`),
      ...review.issues.filter(i => i.severity === "blocking").map(i => `${i.requirementId}: ${i.problem} Fix: ${i.fix}`),
    ];
    return { ok: errors.length === 0, stage: errors.length ? "quality" : "complete", errors, diagnostics: review.experienceAssessment, reviewFile: path.join(outDir, `review-${attempt}.json`), basis: "model code inspection plus automated browser evidence; not human playtesting" };
  };
}
