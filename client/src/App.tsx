import { useEffect, useState } from "react";
import "./App.css";
import { createEntry, deleteEntry, getSummary, listEntries, updateEntry } from "./api";
import { EntryForm } from "./components/EntryForm";
import { EntryList } from "./components/EntryList";
import { SummaryPanel } from "./components/SummaryPanel";
import type { OvertimeEntry, Summary } from "./types";

export default function App() {
  const [entries, setEntries] = useState<OvertimeEntry[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [editingEntry, setEditingEntry] = useState<OvertimeEntry | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  async function refresh() {
    try {
      const [entriesData, summaryData] = await Promise.all([listEntries(), getSummary()]);
      setEntries(entriesData);
      setSummary(summaryData);
      setLoadError(null);
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : "Failed to load overtime data.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    refresh();
  }, []);

  async function handleSubmit(entry: { date: string; hours: number; reason: string }) {
    if (editingEntry) {
      await updateEntry(editingEntry.id, entry);
      setEditingEntry(null);
    } else {
      await createEntry(entry);
    }
    await refresh();
  }

  async function handleDelete(id: number) {
    if (!window.confirm("Delete this overtime entry?")) return;
    await deleteEntry(id);
    if (editingEntry?.id === id) setEditingEntry(null);
    await refresh();
  }

  return (
    <div className="app">
      <header>
        <h1>OverWork</h1>
        <p className="subtitle">Register and track your overtime hours.</p>
      </header>

      {loadError && <p className="form-error">{loadError}</p>}

      <SummaryPanel summary={summary} />

      <div className="layout">
        <EntryForm onSubmit={handleSubmit} editingEntry={editingEntry} onCancelEdit={() => setEditingEntry(null)} />

        <section className="list-section">
          <h2>History</h2>
          {loading ? <p>Loading…</p> : <EntryList entries={entries} onEdit={setEditingEntry} onDelete={handleDelete} />}
        </section>
      </div>
    </div>
  );
}
