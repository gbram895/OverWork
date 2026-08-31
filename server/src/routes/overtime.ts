import { Router } from "express";
import { db } from "../db.js";

export const overtimeRouter = Router();

interface OvertimeEntry {
  id: number;
  date: string;
  hours: number;
  reason: string;
  created_at: string;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function validateEntry(body: unknown): { date: string; hours: number; reason: string } | { error: string } {
  if (typeof body !== "object" || body === null) return { error: "Invalid request body" };
  const { date, hours, reason } = body as Record<string, unknown>;

  if (typeof date !== "string" || !DATE_RE.test(date)) {
    return { error: "date must be a string in YYYY-MM-DD format" };
  }
  if (typeof hours !== "number" || !Number.isFinite(hours) || hours <= 0 || hours > 24) {
    return { error: "hours must be a number greater than 0 and at most 24" };
  }
  if (reason !== undefined && typeof reason !== "string") {
    return { error: "reason must be a string" };
  }
  return { date, hours, reason: typeof reason === "string" ? reason : "" };
}

// List entries, optionally filtered by from/to date (inclusive, YYYY-MM-DD)
overtimeRouter.get("/", (req, res) => {
  const { from, to } = req.query;
  let query = "SELECT * FROM overtime_entries WHERE 1=1";
  const params: string[] = [];

  if (typeof from === "string" && DATE_RE.test(from)) {
    query += " AND date >= ?";
    params.push(from);
  }
  if (typeof to === "string" && DATE_RE.test(to)) {
    query += " AND date <= ?";
    params.push(to);
  }
  query += " ORDER BY date DESC, id DESC";

  const rows = db.prepare(query).all(...params) as OvertimeEntry[];
  res.json(rows);
});

overtimeRouter.get("/summary", (req, res) => {
  const { from, to } = req.query;
  let query = "SELECT COALESCE(SUM(hours), 0) AS totalHours, COUNT(*) AS count FROM overtime_entries WHERE 1=1";
  const params: string[] = [];

  if (typeof from === "string" && DATE_RE.test(from)) {
    query += " AND date >= ?";
    params.push(from);
  }
  if (typeof to === "string" && DATE_RE.test(to)) {
    query += " AND date <= ?";
    params.push(to);
  }

  const row = db.prepare(query).get(...params) as { totalHours: number; count: number };
  res.json(row);
});

overtimeRouter.post("/", (req, res) => {
  const result = validateEntry(req.body);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const { date, hours, reason } = result;
  const info = db
    .prepare("INSERT INTO overtime_entries (date, hours, reason) VALUES (?, ?, ?)")
    .run(date, hours, reason);
  const entry = db.prepare("SELECT * FROM overtime_entries WHERE id = ?").get(info.lastInsertRowid);
  res.status(201).json(entry);
});

overtimeRouter.put("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const existing = db.prepare("SELECT * FROM overtime_entries WHERE id = ?").get(id);
  if (!existing) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  const result = validateEntry(req.body);
  if ("error" in result) {
    res.status(400).json({ error: result.error });
    return;
  }
  const { date, hours, reason } = result;
  db.prepare("UPDATE overtime_entries SET date = ?, hours = ?, reason = ? WHERE id = ?").run(
    date,
    hours,
    reason,
    id
  );
  const entry = db.prepare("SELECT * FROM overtime_entries WHERE id = ?").get(id);
  res.json(entry);
});

overtimeRouter.delete("/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) {
    res.status(400).json({ error: "Invalid id" });
    return;
  }
  const info = db.prepare("DELETE FROM overtime_entries WHERE id = ?").run(id);
  if (info.changes === 0) {
    res.status(404).json({ error: "Entry not found" });
    return;
  }
  res.status(204).send();
});
