import { useEffect, useState } from "react";
import type { OvertimeEntry } from "../types";

interface Props {
  onSubmit: (entry: { date: string; hours: number; reason: string }) => Promise<void>;
  editingEntry: OvertimeEntry | null;
  onCancelEdit: () => void;
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export function EntryForm({ onSubmit, editingEntry, onCancelEdit }: Props) {
  const [date, setDate] = useState(todayIso());
  const [hours, setHours] = useState("");
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (editingEntry) {
      setDate(editingEntry.date);
      setHours(String(editingEntry.hours));
      setReason(editingEntry.reason);
    } else {
      setDate(todayIso());
      setHours("");
      setReason("");
    }
  }, [editingEntry]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const parsedHours = Number(hours);
    if (!date) {
      setError("Please pick a date.");
      return;
    }
    if (!hours || !Number.isFinite(parsedHours) || parsedHours <= 0 || parsedHours > 24) {
      setError("Hours must be a number greater than 0 and at most 24.");
      return;
    }

    setSubmitting(true);
    try {
      await onSubmit({ date, hours: parsedHours, reason: reason.trim() });
      if (!editingEntry) {
        setDate(todayIso());
        setHours("");
        setReason("");
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Something went wrong.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <form className="entry-form" onSubmit={handleSubmit}>
      <h2>{editingEntry ? "Edit overtime entry" : "Log overtime"}</h2>

      <div className="field">
        <label htmlFor="date">Date</label>
        <input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
      </div>

      <div className="field">
        <label htmlFor="hours">Hours</label>
        <input
          id="hours"
          type="number"
          step="0.25"
          min="0.25"
          max="24"
          placeholder="e.g. 2.5"
          value={hours}
          onChange={(e) => setHours(e.target.value)}
          required
        />
      </div>

      <div className="field">
        <label htmlFor="reason">Reason (optional)</label>
        <input
          id="reason"
          type="text"
          placeholder="e.g. Release deployment"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
        />
      </div>

      {error && <p className="form-error">{error}</p>}

      <div className="form-actions">
        <button type="submit" disabled={submitting}>
          {editingEntry ? "Save changes" : "Add entry"}
        </button>
        {editingEntry && (
          <button type="button" className="secondary" onClick={onCancelEdit} disabled={submitting}>
            Cancel
          </button>
        )}
      </div>
    </form>
  );
}
