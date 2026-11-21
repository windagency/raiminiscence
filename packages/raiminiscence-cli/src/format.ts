import type { InspectMemoryResult, InspectQueryResult, RecallResultItem } from "raiminiscence-mcp";

/**
 * Output formatting mirrors the validated prototype's terminal-style layout
 * (box-drawing characters, plain-English glosses like "decaying about 3x
 * slower than an untouched Decision memory would") — the prototype is the
 * reference for tone/shape, not a file ported literally.
 */

const BAR_WIDTH = 20;

function progressBar(fraction: number): string {
  const clamped = Math.max(0, Math.min(1, fraction));
  const filled = Math.round(clamped * BAR_WIDTH);
  return "#".repeat(filled) + "-".repeat(BAR_WIDTH - filled);
}

function capitalize(word: string): string {
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function roundToOneDecimal(n: number): string {
  return n.toFixed(1);
}

/** A single memory's compact one-line summary — the same shape `formatBrowseResults` uses in compact mode. */
function formatMemoryCompact(result: InspectMemoryResult): string {
  return `${result.id}  [${result.kind}, ${result.confidence}]  strength ${result.strength.toFixed(2)}`;
}

/** A single memory's summary — compact by default, or the full diagnostic panel when `detailed`. */
export function formatMemoryPanel(result: InspectMemoryResult, detailed: boolean): string {
  if (!detailed) return formatMemoryCompact(result);

  const { reinforcement, reinforcementCeiling } = result;
  const bonusDays = result.effectiveHalfLifeDays - result.baseHalfLifeDays;
  const speedFactor = result.baseHalfLifeDays > 0 ? result.effectiveHalfLifeDays / result.baseHalfLifeDays : 1;

  const lines = [
    `┌─ ${capitalize(result.kind)} · "${result.summary}"`,
    `│`,
    `│  Strength         ${result.strength.toFixed(2)}  ${progressBar(result.strength)}`,
    `│  Half-life        ${roundToOneDecimal(result.effectiveHalfLifeDays)}d  (base ${result.baseHalfLifeDays}d -> ${bonusDays >= 0 ? "+" : ""}${roundToOneDecimal(bonusDays)}d reinforcement)`,
    `│  Ceiling used     ${Math.round(reinforcementCeiling.percentUsed)}%  ${progressBar(reinforcementCeiling.percentUsed / 100)}  (max ${roundToOneDecimal(reinforcementCeiling.ceilingDays)}d)`,
    `│  Confidence Tier  ${result.confidence}`,
    `│  Age              ${Math.round(result.ageDays)} days`,
    `│  Reinforced by    ${reinforcement.recallCount}x Recall hit · ${reinforcement.positiveFeedbackCount}x positive Outcome Feedback` +
      (reinforcement.negativeFeedbackCount > 0 ? ` · ${reinforcement.negativeFeedbackCount}x negative Outcome Feedback` : ""),
    `│`,
    `│  Recalled ${reinforcement.recallCount} times, confirmed useful ${reinforcement.positiveFeedbackCount} times — decaying about`,
    `│  ${roundToOneDecimal(speedFactor)}x slower than an untouched ${capitalize(result.kind)} memory would.`,
    `└─`,
  ];
  return lines.join("\n");
}

function formatQueryResultLine(index: number, item: RecallResultItem): string {
  const connector = index === 0 ? "┌─" : "├─";
  const lines = [`${connector} ${index + 1}. [${item.kind}, ${item.confidence}] "${item.summary}"`];
  lines.push(`│    score ${item.score.toFixed(3)} · surfacedVia: ${item.surfacedVia}`);
  if (item.conflictsWith?.length) lines.push(`│    conflictsWith: ${item.conflictsWith.join(", ")}`);
  if (item.conflictCandidateWith?.length) lines.push(`│    conflictCandidateWith: ${item.conflictCandidateWith.join(", ")}`);
  return lines.join("\n");
}

/** `inspectQuery`'s output: one panel per qualifying result, then near-misses — collapsed to a count unless `detailed`. */
export function formatQueryResult(result: InspectQueryResult, detailed: boolean): string {
  const lines: string[] = [];
  if (result.results.length === 0) {
    lines.push("┌─ (no qualifying results)");
  } else {
    result.results.forEach((item, index) => lines.push(formatQueryResultLine(index, item)));
  }

  if (detailed) {
    for (const nearMiss of result.nearMisses) {
      lines.push(`│    ${nearMiss.id}  score n/a  strength ${nearMiss.strength.toFixed(2)}  excluded: ${nearMiss.exclusionReason}`);
    }
  } else if (result.nearMisses.length > 0) {
    lines.push(`├─ ${result.nearMisses.length} near-miss${result.nearMisses.length === 1 ? "" : "es"} hidden — rerun with --detailed to show them`);
  }
  lines.push("└─");
  return lines.join("\n");
}

/** `browseMemories`'s output: one line per result in compact mode, one full panel per result when `detailed`. */
export function formatBrowseResults(results: InspectMemoryResult[], detailed: boolean): string {
  if (results.length === 0) return "(no memories matched)";
  if (detailed) return results.map((result) => formatMemoryPanel(result, true)).join("\n\n");
  return results.map(formatMemoryCompact).join("\n");
}
