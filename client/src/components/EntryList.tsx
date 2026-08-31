import type { OvertimeEntry } from "../types";

interface Props {
  entries: OvertimeEntry[];
  onEdit: (entry: OvertimeEntry) => void;
  onDelete: (id: number) => void;
}

export function EntryList({ entries, onEdit, onDelete }: Props) {
  if (entries.length === 0) {
    return <p className="empty-state">No overtime logged yet.</p>;
  }

  return (
    <table className="entry-table">
      <thead>
        <tr>
          <th>Date</th>
          <th>Hours</th>
          <th>Reason</th>
          <th></th>
        </tr>
      </thead>
      <tbody>
        {entries.map((entry) => (
          <tr key={entry.id}>
            <td>{entry.date}</td>
            <td>{entry.hours}</td>
            <td>{entry.reason || <span className="muted">—</span>}</td>
            <td className="row-actions">
              <button type="button" className="link" onClick={() => onEdit(entry)}>
                Edit
              </button>
              <button type="button" className="link danger" onClick={() => onDelete(entry.id)}>
                Delete
              </button>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
