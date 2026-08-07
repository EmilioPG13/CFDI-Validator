import type { BatchAuditReport, CfdiAuditResult } from "./audit";

/**
 * `audit.ts` doesn't re-export `Finding` on its own (it only flows through as the shape of
 * `CfdiAuditResult["findings"]`) and CLAUDE.md/the task brief are explicit that this page
 * must not reach into `engine/` source directly — so the type is derived structurally from
 * what `audit.ts` already exports, instead of importing `engine/src/finding.ts` directly.
 */
export type Finding = CfdiAuditResult["findings"][number];

export interface FileSeverityCounts {
  errors: number;
  warnings: number;
}

export function countSeverities(result: CfdiAuditResult): FileSeverityCounts {
  let errors = 0;
  let warnings = 0;
  for (const finding of result.findings) {
    if (finding.severity === "error") errors++;
    else warnings++;
  }
  return { errors, warnings };
}

/** False when there's nothing for the rule engine to have evaluated at all — either the
 *  document failed XSD validation, or it passed XSD but `parseCfdi` still couldn't make
 *  sense of it. Both are a different, more fundamental class of problem than a rule
 *  finding: the document itself, not a value in it. */
export function isStructurallyEvaluable(result: CfdiAuditResult): boolean {
  return result.xsdValid && !result.parseError;
}

/**
 * Per-file display classification, computed once and reused by both the summary tiles and
 * each file row so the "structural failure vs. rule findings vs. SAT-unverified" distinction
 * can't drift out of sync between the two views.
 *
 * `satUnverified` is intentionally its own field on the `evaluated` branch, never folded
 * into `errors`/`warnings` — a document with zero findings and `satUnverified: true` is NOT
 * the same thing as a clean document (see `CfdiAuditResult.satUnverified`'s own doc comment
 * in engine/src/pipeline.ts): the two SAT-live rules simply didn't get to run for it.
 */
export type FileDisplayStatus =
  | { kind: "structural-error"; reason: "xsd" | "parse" }
  | { kind: "evaluated"; errors: number; warnings: number; satUnverified: boolean };

export function classifyFile(result: CfdiAuditResult): FileDisplayStatus {
  if (!result.xsdValid) return { kind: "structural-error", reason: "xsd" };
  if (result.parseError) return { kind: "structural-error", reason: "parse" };
  const { errors, warnings } = countSeverities(result);
  return { kind: "evaluated", errors, warnings, satUnverified: result.satUnverified === true };
}

export interface ReportSummaryStats {
  filesTotal: number;
  filesStructuralError: number;
  filesEvaluated: number;
  filesClean: number;
  totalErrorFindings: number;
  totalWarningFindings: number;
  filesVerified: number;
  filesUnverified: number;
  skippedTotal: number;
}

/** Aggregates `summarizeReport` needs for the top-of-page scannable summary — the "risk
 *  report in 60 seconds" moment. Walks every file once. */
export function summarizeReport(report: BatchAuditReport): ReportSummaryStats {
  let filesStructuralError = 0;
  let filesClean = 0;
  let totalErrorFindings = 0;
  let totalWarningFindings = 0;
  let filesVerified = 0;
  let filesUnverified = 0;

  for (const { result } of report.files) {
    const status = classifyFile(result);
    if (status.kind === "structural-error") {
      filesStructuralError++;
      continue;
    }
    totalErrorFindings += status.errors;
    totalWarningFindings += status.warnings;
    if (status.errors === 0 && status.warnings === 0) filesClean++;
    if (status.satUnverified) filesUnverified++;
    else filesVerified++;
  }

  return {
    filesTotal: report.files.length,
    filesStructuralError,
    filesEvaluated: report.files.length - filesStructuralError,
    filesClean,
    totalErrorFindings,
    totalWarningFindings,
    filesVerified,
    filesUnverified,
    skippedTotal: report.skipped.length,
  };
}
