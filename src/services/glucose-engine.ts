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
