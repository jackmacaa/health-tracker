import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { DEFAULT_CHALLENGE_ID } from "../config";
import {
  getChallenge,
  getMyChallengeMember,
  listChallengeMembers,
  updateMyChallengeDisplayName,
} from "../api/challenges";
import { listDailyMetricsInRange } from "../api/dailyMetrics";
import type { Challenge, ChallengeMember, DailyMetric } from "../types";
import { toLocalDateTime } from "../lib/date";

interface Props {
  userId: string;
}

export default function LeaderboardPage({ userId }: Props) {
  const [challenge, setChallenge] = useState<Challenge | null>(null);
  const [members, setMembers] = useState<ChallengeMember[]>([]);
  const [metrics, setMetrics] = useState<DailyMetric[]>([]);
  const [displayName, setDisplayName] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    load();

    // Refresh data when page becomes visible (tab focus)
    const handleVisibilityChange = () => {
      if (!document.hidden) {
        load();
      }
    };

    document.addEventListener("visibilitychange", handleVisibilityChange);
    return () =>
      document.removeEventListener("visibilitychange", handleVisibilityChange);
  }, []);

  const rows = useMemo(() => {
    const byUser: Record<string, DailyMetric> = {};
    metrics.forEach((m) => {
      const current = byUser[m.user_id];
      if (!current || m.occurred_at > current.occurred_at) {
        byUser[m.user_id] = m;
      }
    });
    return members
      .map((member) => {
        const latest = byUser[member.user_id];
        const latestWeight = latest?.weight_kg ?? null;
        const percentLoss = latestWeight
          ? ((member.start_weight_kg - latestWeight) / member.start_weight_kg) *
            100
          : null;
        return {
          member,
          latest,
          percentLoss,
        };
      })
      .sort(
        (a, b) => (b.percentLoss ?? -Infinity) - (a.percentLoss ?? -Infinity),
      );
  }, [members, metrics]);

  async function load() {
    if (!DEFAULT_CHALLENGE_ID) {
      setErr(
        "No challenge configured. Set VITE_CHALLENGE_ID to use the leaderboard.",
      );
      return;
    }
    setLoading(true);
    setErr(null);
    try {
      const ch = await getChallenge(DEFAULT_CHALLENGE_ID);
      if (!ch) throw new Error("Challenge not found");
      setChallenge(ch);
      const memberRows = await listChallengeMembers(DEFAULT_CHALLENGE_ID);
      setMembers(memberRows);
      const mine = await getMyChallengeMember(DEFAULT_CHALLENGE_ID, userId);
      setDisplayName(mine?.display_name ?? "");
      const metricsRows = await listDailyMetricsInRange({
        startUtcISO: DateTime.fromISO(ch.start_at).toUTC().toISO()!,
        endUtcISO: DateTime.fromISO(ch.end_at)
          .plus({ days: 1 })
          .toUTC()
          .toISO()!,
      });
      setMetrics(metricsRows);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  async function saveDisplayName() {
    if (!DEFAULT_CHALLENGE_ID) return;
    const trimmed = displayName.trim();
    if (trimmed.length < 3) {
      setErr("Display name must be at least 3 characters");
      return;
    }
    setSaving(true);
    setErr(null);
    setSuccess(null);
    try {
      await updateMyChallengeDisplayName(DEFAULT_CHALLENGE_ID, userId, trimmed);
      setSuccess("Updated");
      await load();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ fontWeight: 600 }}>Challenge Leaderboard</div>
        {challenge ? (
          <div className="item-sub">
            {challenge.name} ·{" "}
            {DateTime.fromISO(challenge.start_at).toFormat("MMM d")} –{" "}
            {DateTime.fromISO(challenge.end_at).toFormat("MMM d")}
          </div>
        ) : (
          <div className="item-sub">
            Configure VITE_CHALLENGE_ID to view standings.
          </div>
        )}
        <div className="stack">
          <label>Display name</label>
          <div className="row" style={{ gap: "8px" }}>
            <input
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder="Pick a handle"
            />
            <button
              className="btn secondary"
              type="button"
              onClick={saveDisplayName}
              disabled={saving}
            >
              {saving ? "Saving…" : "Save"}
            </button>
          </div>
          <div className="item-sub">This appears on the leaderboard.</div>
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
      </div>

      <div className="card stack">
        <div style={{ fontWeight: 600 }}>Standings</div>
        <div className="row" style={{ gap: "8px" }}>
          <button
            className="btn secondary"
            type="button"
            onClick={() => load()}
            disabled={loading}
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
        </div>
        {loading && <div className="item-sub">Loading…</div>}
        {rows.length === 0 && !loading ? (
          <div className="empty">No participants yet</div>
        ) : (
          <div className="list">
            {rows.map((row, idx) => {
              const name =
                row.member.display_name ||
                `User ${row.member.user_id.slice(0, 4)}`;
              const latest = row.latest
                ? toLocalDateTime(
                    row.latest.occurred_at,
                    row.latest.tz_offset_minutes,
                  ).toFormat("MMM d")
                : "—";
              const pct =
                row.percentLoss != null && row.percentLoss > 0
                  ? `${row.percentLoss.toFixed(1)}% loss`
                  : "No loss";
              return (
                <div key={row.member.id} className="item">
                  <div className="item-body">
                    <div className="item-title">
                      #{idx + 1} {name}
                    </div>
                    <div className="item-sub">
                      Last updated {latest} · {pct}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
