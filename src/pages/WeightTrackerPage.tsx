import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { DEFAULT_CHALLENGE_ID } from "../config";
import { listDailyMetricsInRange, upsertDailyMetric, deleteDailyMetric } from "../api/dailyMetrics";
import { getChallenge, getMyChallengeMember } from "../api/challenges";
import JoinChallengeForm from "../components/JoinChallengeForm";
import type { Challenge, ChallengeMember, DailyMetric } from "../types";
import { toLocalDateTime, tzOffsetNowMinutes } from "../lib/date";
import Sparkline from "../components/Sparkline";
import BarChart from "../components/BarChart";

interface Props {
  userId: string;
}

export default function WeightTrackerPage({ userId }: Props) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [member, setMember] = useState<ChallengeMember | null>(null);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [date, setDate] = useState(DateTime.local().toISODate());
  const [weight, setWeight] = useState("");
  const [steps, setSteps] = useState("");
  const [calories, setCalories] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [period, setPeriod] = useState<"week" | "month" | "90days" | "all">("month");
  const [showChallengeOnly, setShowChallengeOnly] = useState(false);

  useEffect(() => {
    load({ showSpinner: true });
  }, []);

  const isInChallenge = (metric: DailyMetric) => {
    if (!challenge) return false;
    const metricDate = DateTime.fromISO(metric.local_date);
    const start = DateTime.fromISO(challenge.start_at).startOf("day");
    const end = DateTime.fromISO(challenge.end_at).endOf("day");
    return metricDate >= start && metricDate <= end;
  };

  const chartPoints = useMemo(() => {
    return metrics.map((m) => {
      const local = toLocalDateTime(m.occurred_at, m.tz_offset_minutes);
      return {
        label: local.toFormat("MMM d"),
        value: m.weight_kg,
      };
    });
  }, [metrics]);

  const stepsChartPoints = useMemo(() => {
    return metrics
      .filter((m) => m.steps != null)
      .map((m) => {
        const local = toLocalDateTime(m.occurred_at, m.tz_offset_minutes);
        return {
          label: local.toFormat("MMM d"),
          value: m.steps!,
        };
      });
  }, [metrics]);

  const challengeStats = useMemo(() => {
    if (!challenge) return null;
    const challengeMetrics = metrics.filter(isInChallenge);
    const metricsWithSteps = challengeMetrics.filter((m) => m.steps != null);
    const metricsWithCalories = challengeMetrics.filter((m) => m.calories_burned != null);

    return {
      avgSteps:
        metricsWithSteps.length > 0
          ? Math.round(
              metricsWithSteps.reduce((sum, m) => sum + m.steps!, 0) / metricsWithSteps.length,
            )
          : null,
      avgCalories:
        metricsWithCalories.length > 0
          ? Math.round(
              metricsWithCalories.reduce((sum, m) => sum + m.calories_burned!, 0) /
                metricsWithCalories.length,
            )
          : null,
    };
  }, [metrics, challenge]);

  const overallStats = useMemo(() => {
    const metricsWithSteps = metrics.filter((m) => m.steps != null);
    const metricsWithCalories = metrics.filter((m) => m.calories_burned != null);

    return {
      avgSteps:
        metricsWithSteps.length > 0
          ? Math.round(
              metricsWithSteps.reduce((sum, m) => sum + m.steps!, 0) / metricsWithSteps.length,
            )
          : null,
      avgCalories:
        metricsWithCalories.length > 0
          ? Math.round(
              metricsWithCalories.reduce((sum, m) => sum + m.calories_burned!, 0) /
                metricsWithCalories.length,
            )
          : null,
    };
  }, [metrics]);

  const trendDays = useMemo(() => {
    if (metrics.length === 0) return 0;
    const earliest = DateTime.fromISO(metrics[0].local_date);
    const latest = DateTime.fromISO(metrics[metrics.length - 1].local_date);
    return Math.ceil(latest.diff(earliest, "days").days) + 1;
  }, [metrics]);

  async function load(options?: { showSpinner?: boolean }) {
    const showSpinner = options?.showSpinner ?? false;
    if (showSpinner) {
      setLoading(true);
    }
    setErr(null);
    try {
      const challengeId = DEFAULT_CHALLENGE_ID || null;
      const foundChallenge = challengeId ? await getChallenge(challengeId) : null;
      setChallenge(foundChallenge);

      if (!foundChallenge) {
        setLoading(false);
        return;
      }

      const memberData = await getMyChallengeMember(foundChallenge.id, userId);
      setMember(memberData);

      if (!memberData) {
        setLoading(false);
        return;
      }

      const allTimeStart = DateTime.local(1970, 1, 1, 0, 0, 0);
      const allTimeEnd = DateTime.now().plus({ days: 1 });
      const rows = await listDailyMetricsInRange({
        startUtcISO: allTimeStart.toUTC().toISO()!,
        endUtcISO: allTimeEnd.toUTC().toISO()!,
        user_id: userId,
      });
      setMetrics(rows);
      const target = rows.find((m) => m.local_date === date);
      if (target) {
        setWeight(String(target.weight_kg));
        setSteps(target.steps != null ? String(target.steps) : "");
        setCalories(target.calories_burned != null ? String(target.calories_burned) : "");
      } else {
        setWeight("");
        setSteps("");
        setCalories("");
      }
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const target = metrics.find((m) => m.local_date === date);
    if (target) {
      setWeight(String(target.weight_kg));
      setSteps(target.steps != null ? String(target.steps) : "");
      setCalories(target.calories_burned != null ? String(target.calories_burned) : "");
    } else {
      // If no entry for this date, prefill weight with most recent entry
      const mostRecent = metrics.length > 0 ? metrics[metrics.length - 1] : null;
      if (mostRecent) {
        setWeight(String(mostRecent.weight_kg));
      } else {
        setWeight("");
      }
      setSteps("");
      setCalories("");
    }
  }, [date, metrics]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    setSuccess(null);
    const weightNum = Number(weight);
    if (!weight || Number.isNaN(weightNum) || weightNum <= 0) {
      setErr("Enter weight in kg (e.g., 89.5)");
      return;
    }
    const stepsNum = steps ? Number(steps) : null;
    const caloriesNum = calories ? Number(calories) : null;
    if (stepsNum != null && (Number.isNaN(stepsNum) || stepsNum < 0)) {
      setErr("Steps must be zero or more");
      return;
    }
    if (caloriesNum != null && (Number.isNaN(caloriesNum) || caloriesNum < 0)) {
      setErr("Calories must be zero or more");
      return;
    }
    const localDay = DateTime.fromISO(date || "");
    if (!localDay.isValid) {
      setErr("Pick a valid date");
      return;
    }
    const occurredAt = localDay
      .set({ hour: 12, minute: 0, second: 0, millisecond: 0 })
      .toUTC()
      .toISO({ suppressMilliseconds: true });
    const tzOffset = tzOffsetNowMinutes();
    setSaving(true);
    try {
      await upsertDailyMetric({
        user_id: userId,
        challenge_id: DEFAULT_CHALLENGE_ID || null,
        occurred_at: occurredAt!,
        tz_offset_minutes: tzOffset,
        weight_kg: Number(weightNum.toFixed(1)),
        steps: stepsNum,
        calories_burned: caloriesNum,
      });
      setSuccess("Saved");
      await load();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  function editEntry(metric: DailyMetric) {
    setDate(metric.local_date);
    setWeight(String(metric.weight_kg));
    setSteps(metric.steps != null ? String(metric.steps) : "");
    setCalories(metric.calories_burned != null ? String(metric.calories_burned) : "");
    setSuccess(null);
    setErr(null);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteEntry(metric: DailyMetric) {
    const ok = confirm("Delete this entry?");
    if (!ok) return;
    setSaving(true);
    setErr(null);
    setSuccess(null);
    try {
      await deleteDailyMetric(metric.id);
      setSuccess("Deleted");
      await load();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const challengeMetrics = challenge ? metrics.filter(isInChallenge) : [];
  const sortedChallengeMetrics = challengeMetrics.sort((a, b) =>
    a.local_date < b.local_date ? -1 : 1,
  );
  const firstChallengeMetric = sortedChallengeMetrics.length > 0 ? sortedChallengeMetrics[0] : null;
  const latestChallengeMetric =
    sortedChallengeMetrics.length > 0
      ? sortedChallengeMetrics[sortedChallengeMetrics.length - 1]
      : null;
  // Use first metric entry as baseline, fall back to member start weight
  const startWeight = firstChallengeMetric?.weight_kg ?? member?.start_weight_kg;
  const challengeProgress =
    startWeight && latestChallengeMetric && sortedChallengeMetrics.length > 1
      ? ((startWeight - latestChallengeMetric.weight_kg) / startWeight) * 100
      : null;

  const getPeriodStartDate = () => {
    const now = DateTime.now();
    switch (period) {
      case "week":
        return now.minus({ days: 7 });
      case "month":
        return now.minus({ months: 1 });
      case "90days":
        return now.minus({ days: 90 });
      case "all":
        return DateTime.local(1970, 1, 1);
    }
  };

  const infoRows = useMemo(() => {
    let filtered = metrics.slice();

    if (showChallengeOnly) {
      filtered = filtered.filter(isInChallenge);
    }

    const periodStart = getPeriodStartDate();
    filtered = filtered.filter((m) => {
      const metricDate = DateTime.fromISO(m.local_date);
      return metricDate >= periodStart;
    });

    return filtered.sort((a, b) => (a.local_date > b.local_date ? -1 : 1));
  }, [metrics, period, showChallengeOnly]);

  return (
    <div className="stack">
      {loading && <div className="card">⏳ Loading…</div>}
      {!loading && challenge && !member && (
        <JoinChallengeForm
          userId={userId}
          challenge={challenge}
          onJoined={() => load({ showSpinner: true })}
        />
      )}
      {!loading && (challenge == null || member != null) && (
        <>
          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div>
                <div style={{ fontWeight: 600 }}>Weight & Activity</div>
                <div className="item-sub">
                  {challenge
                    ? `${challenge.name} (${DateTime.fromISO(challenge.start_at).toFormat("MMM d")} – ${DateTime.fromISO(challenge.end_at).toFormat("MMM d")})`
                    : "Personal log"}
                </div>
                {challenge && challengeProgress != null && (
                  <div
                    className="item-sub"
                    style={{
                      color: challengeProgress > 0 ? "#22c55e" : "#ef4444",
                      fontWeight: 600,
                    }}
                  >
                    Challenge progress:{" "}
                    {challengeProgress > 0
                      ? `${challengeProgress.toFixed(1)}% loss`
                      : challengeProgress < 0
                        ? `${Math.abs(challengeProgress).toFixed(1)}% gain`
                        : "No change"}
                    <div
                      style={{
                        fontSize: "0.85em",
                        fontWeight: 400,
                        color: "#888",
                      }}
                    >
                      (Start: {startWeight?.toFixed(1)}kg → Current:{" "}
                      {latestChallengeMetric?.weight_kg.toFixed(1)}kg)
                    </div>
                  </div>
                )}
              </div>
            </div>
            <form className="stack" onSubmit={submit}>
              <div className="stack">
                <label>Date</label>
                <input
                  type="date"
                  value={date || ""}
                  onChange={(e) => {
                    setDate(e.target.value);
                    setSuccess(null);
                  }}
                />
              </div>
              <div className="stack">
                <label>Weight (kg)</label>
                <input
                  type="number"
                  step="0.1"
                  min="0"
                  value={weight}
                  onChange={(e) => setWeight(e.target.value)}
                  placeholder="100.0"
                  required
                />
              </div>
              <div className="row" style={{ gap: "12px", flexWrap: "wrap" }}>
                <div style={{ flex: 1, minWidth: "160px" }}>
                  <label>Steps (optional)</label>
                  <input
                    type="number"
                    min="0"
                    value={steps}
                    onChange={(e) => setSteps(e.target.value)}
                    placeholder="10000"
                  />
                </div>
                <div style={{ flex: 1, minWidth: "160px" }}>
                  <label>Calories burned (optional)</label>
                  <input
                    type="number"
                    min="0"
                    value={calories}
                    onChange={(e) => setCalories(e.target.value)}
                    placeholder="2000"
                  />
                </div>
              </div>
              {err && (
                <div className="item-sub" style={{ color: "#ff6b6b" }}>
                  {err}
                </div>
              )}
              {success && (
                <div className="item-sub" style={{ color: "#22c55e" }}>
                  {success}
                </div>
              )}
              <button className="btn" type="submit" disabled={saving}>
                {saving ? "💾 Saving…" : "💾 Save"}
              </button>
            </form>
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600 }}>⚖️ Trend 📈</div>
              <div className="item-sub">
                {metrics.length === 0 ? "No weights yet" : `Last ${trendDays} days`}
              </div>
            </div>
            {metrics.length === 0 ? (
              <div className="empty">No weights yet</div>
            ) : (
              <Sparkline data={chartPoints} height={90} />
            )}
          </div>

          <div className="card stack">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div style={{ fontWeight: 600 }}>🚶 Steps 📊</div>
              <div className="item-sub">
                {stepsChartPoints.length === 0
                  ? "No steps logged"
                  : `${stepsChartPoints.length} days logged`}
              </div>
            </div>
            {stepsChartPoints.length === 0 ? (
              <div className="empty">No steps logged yet</div>
            ) : (
              <BarChart data={stepsChartPoints} height={90} color="#3b82f6" />
            )}
          </div>

          {(overallStats.avgSteps != null || overallStats.avgCalories != null) && (
            <div className="card stack">
              <div style={{ fontWeight: 600 }}>🧮 Averages</div>
              <div className="row" style={{ gap: "16px", flexWrap: "wrap" }}>
                {overallStats.avgSteps != null && (
                  <div
                    style={{
                      flex: 1,
                      minWidth: "120px",
                      padding: "12px",
                      background: "#eff6ff",
                      borderRadius: "8px",
                    }}
                  >
                    <div style={{ fontSize: "0.75em", color: "#666" }}>🚶 Avg Steps</div>
                    <div style={{ fontSize: "1.5em", fontWeight: 600, color: "#3b82f6" }}>
                      {overallStats.avgSteps.toLocaleString()}
                    </div>
                  </div>
                )}
                {overallStats.avgCalories != null && (
                  <div
                    style={{
                      flex: 1,
                      minWidth: "120px",
                      padding: "12px",
                      background: "#fef3f2",
                      borderRadius: "8px",
                    }}
                  >
                    <div style={{ fontSize: "0.75em", color: "#666" }}>🔥 Avg Calories</div>
                    <div style={{ fontSize: "1.5em", fontWeight: 600, color: "#ef4444" }}>
                      {overallStats.avgCalories.toLocaleString()}
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="card stack">
            <div className="stack" style={{ gap: "12px" }}>
              <div style={{ fontWeight: 600 }}>Recent entries</div>
              <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
                {(["week", "month", "90days", "all"] as const).map((p) => (
                  <button
                    key={p}
                    className="btn"
                    style={{
                      background: period === p ? "#3b82f6" : "#e5e7eb",
                      color: period === p ? "white" : "black",
                      padding: "6px 12px",
                      fontSize: "12px",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                    onClick={() => setPeriod(p)}
                  >
                    {p === "week"
                      ? "Week"
                      : p === "month"
                        ? "Month"
                        : p === "90days"
                          ? "90 days"
                          : "All time"}
                  </button>
                ))}
              </div>
              {challenge && (
                <div className="row" style={{ gap: "8px" }}>
                  <button
                    className="btn"
                    style={{
                      background: showChallengeOnly ? "#22c55e" : "#e5e7eb",
                      color: showChallengeOnly ? "white" : "black",
                      padding: "6px 12px",
                      fontSize: "12px",
                      border: "none",
                      borderRadius: "6px",
                      cursor: "pointer",
                    }}
                    onClick={() => setShowChallengeOnly(!showChallengeOnly)}
                  >
                    {showChallengeOnly ? "✓ Challenge only" : "All entries"}
                  </button>
                </div>
              )}
            </div>
            {infoRows.length === 0 ? (
              <div className="empty">Nothing logged</div>
            ) : (
              <div className="list">
                {infoRows.map((m) => {
                  const local = toLocalDateTime(m.occurred_at, m.tz_offset_minutes);
                  const inChallenge = isInChallenge(m);
                  return (
                    <div key={m.id} className="item">
                      <div className="item-body">
                        <div className="item-title">
                          {local.toFormat("EEE, MMM d")}
                          {inChallenge && (
                            <span
                              style={{
                                marginLeft: "8px",
                                padding: "2px 8px",
                                borderRadius: "12px",
                                fontSize: "11px",
                                background: "#22c55e",
                                color: "white",
                                fontWeight: 600,
                              }}
                            >
                              Challenge
                            </span>
                          )}
                        </div>
                        <div className="item-sub">
                          Weight {m.weight_kg.toFixed(1)} kg
                          {m.steps != null ? ` · ${m.steps} steps` : ""}
                          {m.calories_burned != null ? ` · ${m.calories_burned} cal burned` : ""}
                        </div>
                      </div>
                      <div className="row">
                        <button
                          className="btn secondary"
                          type="button"
                          onClick={() => editEntry(m)}
                          disabled={saving}
                        >
                          ✏️
                        </button>
                        <button
                          className="btn danger"
                          type="button"
                          onClick={() => deleteEntry(m)}
                          disabled={saving}
                        >
                          🗑️
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}

function boundsForMetrics(challenge: Challenge | null) {
  const start = challenge
    ? DateTime.fromISO(challenge.start_at).startOf("day")
    : DateTime.local(1970, 1, 1, 0, 0, 0);
  const end = challenge
    ? DateTime.fromISO(challenge.end_at).endOf("day")
    : DateTime.now().plus({ days: 1 });
  return {
    startUtcISO: start.toUTC().toISO(),
    endUtcISO: end.toUTC().toISO(),
  };
}
