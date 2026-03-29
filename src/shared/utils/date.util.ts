// src/shared/utils/date.util.ts

// ── Get the Monday of the week containing a given date ────────────────────
// Used by the forecasting module to group orders by ISO week.
export function getWeekStart(date: Date): Date {
  const d    = new Date(date);
  const day  = d.getDay();                          // 0 = Sunday
  const diff = d.getDate() - day + (day === 0 ? -6 : 1);
  d.setDate(diff);
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── Add N days to a date ──────────────────────────────────────────────────
export function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

// ── Difference in days between two dates ─────────────────────────────────
export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / 86_400_000);
}

// ── Is date in the past ───────────────────────────────────────────────────
export function isOverdue(date: Date): boolean {
  return date < new Date();
}

// ── Format date as DD/MM/YYYY (Indian standard) ───────────────────────────
export function formatIndianDate(date: Date): string {
  return date.toLocaleDateString('en-IN', {
    day:   '2-digit',
    month: '2-digit',
    year:  'numeric',
  });
}

// ── Start and end of a financial year (April–March, India) ───────────────
export function getFinancialYear(date: Date = new Date()): {
  start: Date;
  end:   Date;
  label: string;
} {
  const year  = date.getMonth() >= 3 ? date.getFullYear() : date.getFullYear() - 1;
  const start = new Date(year,     3, 1);   // April 1
  const end   = new Date(year + 1, 2, 31);  // March 31
  return { start, end, label: `FY ${year}–${(year + 1).toString().slice(2)}` };
}
