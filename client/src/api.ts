import type { OvertimeEntry, Summary } from "./types";

const BASE = "/api/overtime";

async function handle<T>(res: Response): Promise<T> {
  if (!res.ok) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with status ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export function listEntries(): Promise<OvertimeEntry[]> {
  return fetch(BASE).then((res) => handle<OvertimeEntry[]>(res));
}

export function getSummary(): Promise<Summary> {
  return fetch(`${BASE}/summary`).then((res) => handle<Summary>(res));
}

export function createEntry(entry: { date: string; hours: number; reason: string }): Promise<OvertimeEntry> {
  return fetch(BASE, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).then((res) => handle<OvertimeEntry>(res));
}

export function updateEntry(
  id: number,
  entry: { date: string; hours: number; reason: string }
): Promise<OvertimeEntry> {
  return fetch(`${BASE}/${id}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(entry),
  }).then((res) => handle<OvertimeEntry>(res));
}

export function deleteEntry(id: number): Promise<void> {
  return fetch(`${BASE}/${id}`, { method: "DELETE" }).then((res) => handle<void>(res));
}
