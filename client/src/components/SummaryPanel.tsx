import type { Summary } from "../types";

export function SummaryPanel({ summary }: { summary: Summary | null }) {
  return (
    <div className="summary-panel">
      <div>
        <span className="summary-value">{summary ? summary.totalHours : "—"}</span>
        <span className="summary-label">total overtime hours</span>
      </div>
      <div>
        <span className="summary-value">{summary ? summary.count : "—"}</span>
        <span className="summary-label">entries logged</span>
      </div>
    </div>
  );
}
