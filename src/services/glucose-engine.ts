/**
 * Pure glucose math: time-in-range, mean, GMI, GVI. No IO.
 */
import { MH_HIGH_MGDL, MH_LOW_MGDL, TIR_HIGH_MGDL, TIR_LOW_MGDL } from "../constants.js";

export interface GlucoseReading {
  /** ISO-8601 timestamp. */
  timestamp: string;
  /** Glucose in mg/dL. */
  mgdl: number;
  /** Optional trend arrow if provided by upstream. */
  trend?: string;
}

export interface TimeInRangeStats {
  count: number;
  in_range_pct: number;
  below_pct: number;
  above_pct: number;
  range: { low: number; high: number };
  buckets: { below: number; in_range: number; above: number };
}

export interface GlucoseSummary {
  count: number;
  mean_mgdl: number;
  median_mgdl: number;
  min_mgdl: number;
  max_mgdl: number;
  std_mgdl: number;
  /** Glucose Management Indicator (estimated A1C) — Bergenstal 2018 formula. */
  gmi_pct: number;
  cv_pct: number;
  diabetic_tir: TimeInRangeStats;
  metabolic_health_tir: TimeInRangeStats;
}

export function timeInRange(
  readings: GlucoseReading[],
  low: number,
  high: number,
): TimeInRangeStats {
  const count = readings.length;
  if (count === 0) {
    return {
      count: 0,
      in_range_pct: 0,
      below_pct: 0,
      above_pct: 0,
      range: { low, high },
      buckets: { below: 0, in_range: 0, above: 0 },
    };
  }
  let below = 0;
  let inRange = 0;
  let above = 0;
  for (const r of readings) {
    if (r.mgdl < low) below++;
    else if (r.mgdl > high) above++;
    else inRange++;
  }
  return {
    count,
    in_range_pct: round1((inRange / count) * 100),
    below_pct: round1((below / count) * 100),
    above_pct: round1((above / count) * 100),
    range: { low, high },
    buckets: { below, in_range: inRange, above },
  };
}

export interface TimeInRangeWindowResult extends TimeInRangeStats {
  /** Effective ISO timestamp the window starts at (defaults to earliest reading if absent). */
  start_time?: string;
  /** Effective ISO timestamp the window ends at (defaults to latest reading if absent). */
  end_time?: string;
  /** Total readings considered before any window/hour-of-day filter. */
  total_readings: number;
  /** Readings after window + hour-of-day filtering (alias of `count` for spec compatibility). */
  readings_in_window: number;
  /** Mean glucose (mg/dL) of readings in the window. 0 when window is empty. */
  mean_glucose: number;
  /** Median glucose (mg/dL) of readings in the window. 0 when window is empty. */
  median_glucose: number;
  /** GMI (estimated A1C, %) for the in-window mean — ADA / Bergenstal 2018. 0 when window is empty. */
  gmi: number;
  /** Resolved hour-of-day filter (UTC) applied on top of the time window, if any. */
  hour_of_day_filter?: { start_hour: number; end_hour: number; preset?: TimeWindowPreset };
}

export type TimeWindowPreset = "all" | "wake" | "sleep";

/**
 * Filter readings to those in [start_time, end_time] (inclusive), optionally
 * restricted to a recurring hour-of-day window (e.g. wake = 06:00-22:00,
 * sleep = 22:00-06:00), then compute time-in-range over the filtered set.
 * Empty result correctly returns `readings_in_window: 0` without crashing.
 *
 * Defaults: start=earliest reading, end=latest reading, time_window="all".
 *
 * v0.3.2:
 *  - Adds explicit `total_readings`, `readings_in_window`, `mean_glucose`,
 *    `median_glucose`, `gmi` so callers don't have to recompute them.
 *  - Adds `time_window` ("all" | "wake" | "sleep") and explicit
 *    `start_hour`/`end_hour` (0-24) for recurring hour-of-day filters that
 *    span midnight (sleep) or stay within a single day (wake). Wake defaults
 *    to 06:00-22:00; sleep defaults to 22:00-06:00. Hour comparisons use UTC
 *    so they're deterministic regardless of process timezone — callers who
 *    need local-time semantics should pass explicit `start_hour`/`end_hour`
 *    derived from their own tz.
 *  - GMI uses the ADA / Bergenstal 2018 formula:
 *      GMI(%) = 3.31 + 0.02392 × mean_glucose_mg_dL
 *    so mean=154 mg/dL → GMI ≈ 7.0.
 */
export function timeInRangeWindow(
  readings: GlucoseReading[],
  options: {
    start_time?: string;
    end_time?: string;
    low?: number;
    high?: number;
    time_window?: TimeWindowPreset;
    start_hour?: number;
    end_hour?: number;
  } = {},
): TimeInRangeWindowResult {
  const low = options.low ?? 70;
  const high = options.high ?? 180;
  const total = readings.length;

  const empty = (): TimeInRangeWindowResult => ({
    ...timeInRange([], low, high),
    total_readings: total,
    readings_in_window: 0,
    mean_glucose: 0,
    median_glucose: 0,
    gmi: 0,
  });

  if (total === 0) {
    return empty();
  }

  const startMs = options.start_time ? new Date(options.start_time).getTime() : -Infinity;
  const endMs = options.end_time ? new Date(options.end_time).getTime() : Infinity;
  if (Number.isNaN(startMs) || Number.isNaN(endMs)) {
    throw new Error("Invalid start_time / end_time — must be ISO-8601 timestamps");
  }

  // Resolve hour-of-day filter from preset OR explicit start_hour/end_hour.
  const hourFilter = resolveHourFilter(options.time_window, options.start_hour, options.end_hour);

  const filtered = readings.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    if (!Number.isFinite(t) || t < startMs || t > endMs) return false;
    if (hourFilter) {
      const hour = new Date(t).getUTCHours();
      return hourInRange(hour, hourFilter.start_hour, hourFilter.end_hour);
    }
    return true;
  });

  const stats = timeInRange(filtered, low, high);
  if (filtered.length === 0) {
    return {
      ...empty(),
      hour_of_day_filter: hourFilter,
    };
  }

  const sorted = [...filtered].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
  );
  const mgdls = filtered.map((r) => r.mgdl);
  const meanG = avg(mgdls);
  const sortedMgdl = [...mgdls].sort((a, b) => a - b);
  const medianG = sortedMgdl[Math.floor(sortedMgdl.length / 2)] ?? 0;

  return {
    ...stats,
    start_time: sorted[0]?.timestamp,
    end_time: sorted[sorted.length - 1]?.timestamp,
    total_readings: total,
    readings_in_window: filtered.length,
    mean_glucose: round1(meanG),
    median_glucose: round1(medianG),
    gmi: round2(3.31 + 0.02392 * meanG),
    hour_of_day_filter: hourFilter,
  };
}

/**
 * Resolve the hour-of-day filter: explicit start_hour/end_hour wins; otherwise
 * `time_window` preset ("wake" = 06:00-22:00, "sleep" = 22:00-06:00, "all" =
 * no filter). Returns `undefined` when no filter applies.
 */
function resolveHourFilter(
  preset: TimeWindowPreset | undefined,
  startHour: number | undefined,
  endHour: number | undefined,
): { start_hour: number; end_hour: number; preset?: TimeWindowPreset } | undefined {
  if (startHour !== undefined && endHour !== undefined) {
    validateHour(startHour, "start_hour");
    validateHour(endHour, "end_hour");
    return { start_hour: startHour, end_hour: endHour };
  }
  if (preset === undefined || preset === "all") return undefined;
  if (preset === "wake") return { start_hour: 6, end_hour: 22, preset };
  if (preset === "sleep") return { start_hour: 22, end_hour: 6, preset };
  throw new Error(`Unknown time_window preset: ${preset}`);
}

function validateHour(hour: number, name: string): void {
  if (!Number.isFinite(hour) || hour < 0 || hour > 24) {
    throw new Error(`${name} must be in [0, 24]; got ${hour}`);
  }
}

/**
 * Returns true when `hour` is in the recurring hour-of-day range
 * [start, end). Handles wrap-around (e.g. sleep 22→6) by ORing the two
 * sub-ranges. start === end means "full day" (always true).
 */
function hourInRange(hour: number, start: number, end: number): boolean {
  if (start === end) return true;
  if (start < end) return hour >= start && hour < end;
  // wrap-around (e.g. 22→6): hour >= 22 OR hour < 6
  return hour >= start || hour < end;
}

export function summarize(readings: GlucoseReading[]): GlucoseSummary {
  if (readings.length === 0) {
    return {
      count: 0,
      mean_mgdl: 0,
      median_mgdl: 0,
      min_mgdl: 0,
      max_mgdl: 0,
      std_mgdl: 0,
      gmi_pct: 0,
      cv_pct: 0,
      diabetic_tir: timeInRange([], TIR_LOW_MGDL, TIR_HIGH_MGDL),
      metabolic_health_tir: timeInRange([], MH_LOW_MGDL, MH_HIGH_MGDL),
    };
  }
  const mgdls = readings.map((r) => r.mgdl);
  const mean = avg(mgdls);
  const sorted = [...mgdls].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  const min = sorted[0];
  const max = sorted[sorted.length - 1];
  const std = stdev(mgdls, mean);
  // Bergenstal 2018: GMI(%) = 3.31 + 0.02392 × mean(mg/dL)
  const gmi = 3.31 + 0.02392 * mean;
  const cv = (std / mean) * 100;
  return {
    count: readings.length,
    mean_mgdl: round1(mean),
    median_mgdl: round1(median),
    min_mgdl: round1(min),
    max_mgdl: round1(max),
    std_mgdl: round1(std),
    gmi_pct: round2(gmi),
    cv_pct: round1(cv),
    diabetic_tir: timeInRange(readings, TIR_LOW_MGDL, TIR_HIGH_MGDL),
    metabolic_health_tir: timeInRange(readings, MH_LOW_MGDL, MH_HIGH_MGDL),
  };
}

export interface MealGlucoseResponse {
  meal_time: string;
  baseline_mgdl: number;
  peak_mgdl: number;
  peak_delta_mgdl: number;
  peak_time_minutes: number;
  return_to_baseline_minutes: number | null;
  band: "excellent" | "good" | "moderate" | "poor";
}

/**
 * Estimate glucose response to a meal:
 * - baseline = last reading <= meal_time (or first available)
 * - peak = max in [meal_time, meal_time + 3h]
 * - return_to_baseline = first time after peak where mgdl <= baseline + 10
 *
 * Bands per Levels-style spike thresholds:
 * - excellent: peak_delta < 30 mg/dL
 * - good: peak_delta < 50
 * - moderate: peak_delta < 80
 * - poor: peak_delta >= 80
 */
export function mealResponse(readings: GlucoseReading[], mealTimeIso: string): MealGlucoseResponse | null {
  if (readings.length === 0) return null;
  const mealMs = new Date(mealTimeIso).getTime();
  const sorted = [...readings].sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
  const before = sorted.filter((r) => new Date(r.timestamp).getTime() <= mealMs);
  const baseline = before[before.length - 1] ?? sorted[0];
  const window = sorted.filter((r) => {
    const t = new Date(r.timestamp).getTime();
    return t >= mealMs && t <= mealMs + 3 * 60 * 60 * 1000;
  });
  if (window.length === 0) return null;
  let peak = window[0];
  for (const r of window) if (r.mgdl > peak.mgdl) peak = r;
  const peakDelta = peak.mgdl - baseline.mgdl;
  const peakTimeMin = Math.round((new Date(peak.timestamp).getTime() - mealMs) / 60000);
  const after = sorted.filter((r) => new Date(r.timestamp).getTime() > new Date(peak.timestamp).getTime());
  const returnReading = after.find((r) => r.mgdl <= baseline.mgdl + 10);
  const returnMin = returnReading
    ? Math.round((new Date(returnReading.timestamp).getTime() - mealMs) / 60000)
    : null;
  let band: MealGlucoseResponse["band"];
  if (peakDelta < 30) band = "excellent";
  else if (peakDelta < 50) band = "good";
  else if (peakDelta < 80) band = "moderate";
  else band = "poor";
  return {
    meal_time: mealTimeIso,
    baseline_mgdl: round1(baseline.mgdl),
    peak_mgdl: round1(peak.mgdl),
    peak_delta_mgdl: round1(peakDelta),
    peak_time_minutes: peakTimeMin,
    return_to_baseline_minutes: returnMin,
    band,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
function avg(arr: number[]): number {
  return arr.reduce((a, b) => a + b, 0) / arr.length;
}
function stdev(arr: number[], mean: number): number {
  if (arr.length === 0) return 0;
  const sq = arr.reduce((acc, v) => acc + (v - mean) ** 2, 0) / arr.length;
  return Math.sqrt(sq);
}

/**
 * Generate sample readings simulating a Dexcom 5-minute interval over the last N hours.
 * Used in mock mode when no Dexcom token is configured.
 */
export function mockReadings(hours: number = 24, baseline: number = 95): GlucoseReading[] {
  const readings: GlucoseReading[] = [];
  const now = Date.now();
  const points = Math.max(1, Math.round((hours * 60) / 5));
  for (let i = points - 1; i >= 0; i--) {
    const t = new Date(now - i * 5 * 60 * 1000).toISOString();
    // Simple drift + simulated meal spikes at 8h and 13h ago
    const hoursAgo = (i * 5) / 60;
    let value = baseline + Math.sin(hoursAgo / 2) * 8;
    // simulate breakfast spike around 7am-ish (8h ago in this synth)
    if (hoursAgo >= 7.5 && hoursAgo <= 9) value += 35 - (hoursAgo - 7.5) * 20;
    // simulated lunch
    if (hoursAgo >= 12 && hoursAgo <= 14) value += 50 - (hoursAgo - 12) * 25;
    readings.push({ timestamp: t, mgdl: round1(value) });
  }
  return readings.reverse();
}
