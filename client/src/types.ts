export interface OvertimeEntry {
  id: number;
  date: string;
  hours: number;
  reason: string;
  created_at: string;
}

export interface Summary {
  totalHours: number;
  count: number;
}
