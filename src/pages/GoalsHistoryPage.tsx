import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  countUnredeemedGoalRewards,
  getGoalRewardSettings,
  listGoalRewardAttemptsRange,
  redeemGoalRewardsQuantity,
  spinGoalRewardForToday,
} from "../api/goalRewards";
import {
  listGoalDailyItemProgressRange,
  listGoalDailyProgressRange,
  listGoalTemplatesWithItems,
} from "../api/goals";
import { tzOffsetNowMinutes } from "../lib/date";
import { playWheelSound, startWheelTickTrack } from "../lib/wheelFx";
import {
  isRewardEligible,
  isTemplateCompleted,
  keyByTemplateId,
  keyByTemplateItemId,
  summarizeDay,
  toLocalDateISO,
} from "./goalsUtils";

interface Props {
  userId: string;
}

interface WheelSector {
  startDeg: number;
  endDeg: number;
  win: boolean;
}

function buildWheelSectors(chancePercent: number, segmentCount: number): WheelSector[] {
  const safeChance = Math.max(0, Math.min(100, chancePercent));
  const safeSegments = Math.max(2, Math.min(72, Math.floor(segmentCount)));

  if (safeChance <= 0) {
    return [...Array(safeSegments)].map((_, index) => ({
      startDeg: (index * 360) / safeSegments,
      endDeg: ((index + 1) * 360) / safeSegments,
      win: false,
    }));
  }

  if (safeChance >= 100) {
    return [...Array(safeSegments)].map((_, index) => ({
      startDeg: (index * 360) / safeSegments,
      endDeg: ((index + 1) * 360) / safeSegments,
      win: true,
    }));
  }

  let winSegments = Math.round((safeChance / 100) * safeSegments);
  winSegments = Math.max(1, Math.min(safeSegments - 1, winSegments));

  const sectorWins = new Array<boolean>(safeSegments).fill(false);
  for (let index = 0; index < winSegments; index += 1) {
    const position = Math.floor((index * safeSegments) / winSegments);
    sectorWins[position] = true;
  }

  let assignedWins = sectorWins.filter(Boolean).length;
  if (assignedWins < winSegments) {
    for (let index = 0; index < safeSegments && assignedWins < winSegments; index += 1) {
      if (!sectorWins[index]) {
        sectorWins[index] = true;
        assignedWins += 1;
      }
    }
  }

  return sectorWins.map((win, index) => ({
    startDeg: (index * 360) / safeSegments,
    endDeg: ((index + 1) * 360) / safeSegments,
    win,
  }));
}

function buildWheelGradient(sectors: WheelSector[]) {
  return `conic-gradient(${sectors
    .map((sector) => {
      const color = sector.win ? "#16a34a" : "#ef4444";
      return `${color} ${sector.startDeg}deg ${sector.endDeg}deg`;
    })
    .join(", ")})`;
}

function pickLandingAngle(params: {
  sectors: WheelSector[];
  didWin: boolean;
  rolledPercent: number;
}) {
  const matchingSectors = params.sectors.filter((sector) => sector.win === params.didWin);
  if (matchingSectors.length === 0) {
    return Math.max(0, Math.min(99.999, params.rolledPercent)) * 3.6;
  }

  const picked = matchingSectors[Math.floor(Math.random() * matchingSectors.length)];
  const span = Math.max(0.4, picked.endDeg - picked.startDeg);
  const margin = Math.min(0.2, span / 4);
  const minDeg = picked.startDeg + margin;
  const maxDeg = picked.endDeg - margin;

  if (maxDeg <= minDeg) {
    return (picked.startDeg + picked.endDeg) / 2;
  }

  return minDeg + Math.random() * (maxDeg - minDeg);
}

export default function GoalsHistoryPage({ userId }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [redeemQuantity, setRedeemQuantity] = useState("1");
  const [availableRewards, setAvailableRewards] = useState(0);
  const [rewardSettings, setRewardSettings] =
    useState<Awaited<ReturnType<typeof getGoalRewardSettings>>>(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelSoundOn, setWheelSoundOn] = useState(true);
  const [winBurstActive, setWinBurstActive] = useState(false);
  const spinTickStopRef = useRef<(() => void) | null>(null);
  const spinEndTimeoutRef = useRef<number | null>(null);
  const winBurstTimeoutRef = useRef<number | null>(null);

  const [templates, setTemplates] = useState<
    Awaited<ReturnType<typeof listGoalTemplatesWithItems>>
  >([]);
  const [progressRows, setProgressRows] = useState<
    Awaited<ReturnType<typeof listGoalDailyProgressRange>>
  >([]);
  const [itemProgressRows, setItemProgressRows] = useState<
    Awaited<ReturnType<typeof listGoalDailyItemProgressRange>>
  >([]);
  const [attemptRows, setAttemptRows] = useState<
    Awaited<ReturnType<typeof listGoalRewardAttemptsRange>>
  >([]);

  const today = DateTime.local();
  const endDate = toLocalDateISO(today);
  const recentDaysToShow = 7;
  const tokenWindowDays = 120;
  const startDate = toLocalDateISO(today.minus({ days: tokenWindowDays - 1 }));

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [templateData, progressData, itemProgressData, rewardData, availableCount, settings] =
        await Promise.all([
          listGoalTemplatesWithItems(userId),
          listGoalDailyProgressRange({
            user_id: userId,
            start_local_date: startDate,
            end_local_date: endDate,
          }),
          listGoalDailyItemProgressRange({
            user_id: userId,
            start_local_date: startDate,
            end_local_date: endDate,
          }),
          listGoalRewardAttemptsRange({
            user_id: userId,
            start_local_date: startDate,
            end_local_date: endDate,
          }),
          countUnredeemedGoalRewards(userId),
          getGoalRewardSettings(userId),
        ]);
      setTemplates(templateData);
      setProgressRows(progressData);
      setItemProgressRows(itemProgressData);
      setAttemptRows(rewardData);
      setAvailableRewards(availableCount);
      setRewardSettings(settings);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  const recentDates = useMemo(() => {
    return [...Array(recentDaysToShow)].map((_, index) =>
      toLocalDateISO(today.minus({ days: index })),
    );
  }, [today.toISODate()]);

  const tokenDatesWindow = useMemo(() => {
    return [...Array(tokenWindowDays)].map((_, index) =>
      toLocalDateISO(today.minus({ days: index })),
    );
  }, [today.toISODate()]);

  const rowsByDate = useMemo(() => {
    const progressByDate: Record<string, ReturnType<typeof keyByTemplateId>> = {};
    const itemByDate: Record<string, ReturnType<typeof keyByTemplateItemId>> = {};
    const attemptsByDate: Record<string, (typeof attemptRows)[number]> = {};

    tokenDatesWindow.forEach((date) => {
      const dayProgress = progressRows.filter((row) => row.local_date === date);
      const dayItemProgress = itemProgressRows.filter((row) => row.local_date === date);
      progressByDate[date] = keyByTemplateId(dayProgress);
      itemByDate[date] = keyByTemplateItemId(dayItemProgress);
    });

    attemptRows.forEach((attempt) => {
      attemptsByDate[attempt.local_date] = attempt;
    });

    return { progressByDate, itemByDate, attemptsByDate };
  }, [tokenDatesWindow, progressRows, itemProgressRows, attemptRows]);

  const activeTemplates = templates.filter((template) => template.active);

  const summaryByDate = useMemo(() => {
    const mapped: Record<string, ReturnType<typeof summarizeDay>> = {};
    tokenDatesWindow.forEach((date) => {
      const dayProgress = rowsByDate.progressByDate[date] ?? {};
      const dayItemProgress = rowsByDate.itemByDate[date] ?? {};
      mapped[date] = summarizeDay(activeTemplates, dayProgress, dayItemProgress);
    });
    return mapped;
  }, [tokenDatesWindow, rowsByDate, activeTemplates]);

  const bankedSpinDates = useMemo(() => {
    if (!rewardSettings) return [] as string[];

    const dates = tokenDatesWindow.filter((date) => {
      if (rowsByDate.attemptsByDate[date]) return false;
      const summary = summaryByDate[date];
      return isRewardEligible(rewardSettings, summary.completed, summary.total);
    });

    return [...dates].sort((a, b) => a.localeCompare(b));
  }, [rewardSettings, tokenDatesWindow, rowsByDate, summaryByDate]);

  const oldestBankedSpinDate = bankedSpinDates[0] ?? null;

  const chancePercent = Math.max(0, Math.min(100, rewardSettings?.chance_percent ?? 0));
  const wheelSegmentCount = Math.max(2, Math.min(72, rewardSettings?.wheel_segment_count ?? 12));
  const wheelSectors = useMemo(
    () => buildWheelSectors(chancePercent, wheelSegmentCount),
    [chancePercent, wheelSegmentCount],
  );
  const wheelGradient = useMemo(() => buildWheelGradient(wheelSectors), [wheelSectors]);

  const totalWins = attemptRows.filter((attempt) => attempt.did_win).length;
  const canRedeem = (() => {
    const parsed = Number(redeemQuantity);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= availableRewards;
  })();

  useEffect(() => {
    return () => {
      spinTickStopRef.current?.();
      if (spinEndTimeoutRef.current != null) {
        window.clearTimeout(spinEndTimeoutRef.current);
      }
      if (winBurstTimeoutRef.current != null) {
        window.clearTimeout(winBurstTimeoutRef.current);
      }
    };
  }, []);

  async function spinBankedToken() {
    if (!rewardSettings) {
      setError("Configure reward settings first in Goals Setup.");
      return;
    }

    if (!oldestBankedSpinDate) {
      setError("No banked spin tokens available.");
      return;
    }

    const summary = summaryByDate[oldestBankedSpinDate];
    if (!summary) {
      setError("Could not resolve token summary for selected day.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    let didCreateAttempt = false;
    let didWinResult = false;
    try {
      const attempt = await spinGoalRewardForToday({
        user_id: userId,
        local_date: oldestBankedSpinDate,
        tz_offset_minutes: tzOffsetNowMinutes(),
        settings: rewardSettings,
        eligible_goal_count: summary.completed,
        total_goal_count: summary.total,
      });
      didCreateAttempt = true;
      didWinResult = attempt.did_win;

      const desiredPointerAngle = pickLandingAngle({
        sectors: wheelSectors,
        didWin: attempt.did_win,
        rolledPercent: attempt.rolled_value,
      });

      setWheelSpinning(true);
      playWheelSound("start", wheelSoundOn);
      spinTickStopRef.current?.();
      spinTickStopRef.current = startWheelTickTrack(4000, wheelSoundOn);
      setWheelRotation((prev) => {
        const currentNormalized = ((prev % 360) + 360) % 360;
        const finalNormalized = (360 - desiredPointerAngle) % 360;
        const deltaNormalized = (finalNormalized - currentNormalized + 360) % 360;
        const spinDegrees = 3600 + deltaNormalized;
        return prev + spinDegrees;
      });

      const label = DateTime.fromISO(oldestBankedSpinDate).toFormat("ccc, LLL d");
      setSuccess(
        attempt.did_win
          ? `Token spun for ${label}: WIN (${attempt.reward_label})`
          : `Token spun for ${label}: MISS`,
      );
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      if (!didCreateAttempt) {
        spinTickStopRef.current?.();
        setWheelSpinning(false);
        setWinBurstActive(false);
        setSaving(false);
        return;
      }

      if (spinEndTimeoutRef.current != null) {
        window.clearTimeout(spinEndTimeoutRef.current);
      }
      spinEndTimeoutRef.current = window.setTimeout(() => {
        setWheelSpinning(false);
        spinTickStopRef.current?.();
        playWheelSound(didWinResult ? "win" : "miss", wheelSoundOn);
      }, 4200);

      if (didWinResult) {
        setWinBurstActive(true);
        if (winBurstTimeoutRef.current != null) {
          window.clearTimeout(winBurstTimeoutRef.current);
        }
        winBurstTimeoutRef.current = window.setTimeout(() => setWinBurstActive(false), 1100);
      } else {
        setWinBurstActive(false);
      }
      setSaving(false);
    }
  }

  async function redeemRewards() {
    const quantity = Number(redeemQuantity);
    if (!Number.isInteger(quantity) || quantity <= 0) {
      setError("Enter a valid whole number to redeem.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const redeemed = await redeemGoalRewardsQuantity({
        user_id: userId,
        quantity,
      });
      setSuccess(`Redeemed ${redeemed} reward${redeemed === 1 ? "" : "s"}.`);
      setRedeemQuantity("1");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Rewards Wallet</div>
        <div className="goal-summary-row">
          <div className="goal-pill goal-pill-success">Available: {availableRewards}</div>
          <div className="goal-pill">Wins in last 7 days: {totalWins}</div>
          <div className="goal-pill">Banked spin tokens: {bankedSpinDates.length}</div>
        </div>
        <div className="row" style={{ gap: "8px" }}>
          <input
            type="number"
            min="1"
            step="1"
            value={redeemQuantity}
            onChange={(e) => setRedeemQuantity(e.target.value)}
            placeholder="How many to redeem"
            disabled={saving}
          />
          <button
            className="btn secondary"
            type="button"
            disabled={saving || !canRedeem}
            onClick={redeemRewards}
          >
            Redeem
          </button>
        </div>
        <div className="item-sub">
          Redeem from your total balance at any time. Rewards are consumed oldest-first.
        </div>
      </div>

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Spin Tokens</div>
        <div className="item-sub">
          Eligible days you did not spin are banked as tokens. Spin them here later.
        </div>
        <div className={`goal-wheel-wrap ${winBurstActive ? "is-win-burst" : ""}`}>
          <div className={`goal-wheel-pointer ${wheelSpinning ? "is-ticking" : ""}`} />
          <div
            className={`goal-wheel ${wheelSpinning ? "is-spinning" : ""}`}
            style={{
              transform: `rotate(${wheelRotation}deg)`,
              background: wheelGradient,
            }}
          >
            <button
              className="goal-wheel-center"
              type="button"
              disabled={saving || wheelSpinning || !rewardSettings || !oldestBankedSpinDate}
              onClick={spinBankedToken}
            >
              {wheelSpinning ? "..." : "SPIN"}
            </button>
          </div>
          {winBurstActive && (
            <>
              <span className="goal-confetti goal-confetti-1" />
              <span className="goal-confetti goal-confetti-2" />
              <span className="goal-confetti goal-confetti-3" />
              <span className="goal-confetti goal-confetti-4" />
              <span className="goal-confetti goal-confetti-5" />
              <span className="goal-confetti goal-confetti-6" />
            </>
          )}
        </div>
        <div className="goal-wheel-legend">
          <span className="goal-wheel-legend-win">Win zone: {chancePercent.toFixed(1)}%</span>
          <span className="goal-wheel-legend-miss">
            Miss zone: {(100 - chancePercent).toFixed(1)}%
          </span>
          <span className="goal-wheel-legend-miss">Segments: {wheelSegmentCount}</span>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setWheelSoundOn((value) => !value)}
          >
            Sound: {wheelSoundOn ? "On" : "Off"}
          </button>
        </div>
        <div className="item-sub">
          {oldestBankedSpinDate
            ? `Next token to spin: ${DateTime.fromISO(oldestBankedSpinDate).toFormat("cccc, LLL d")}`
            : "No banked spin tokens right now."}
        </div>
      </div>

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Last 7 Days</div>
        <div className="item-sub">
          Green check means all active daily goals were completed that day.
        </div>
      </div>

      {loading && <div className="card">Loading history...</div>}

      {!loading &&
        recentDates.map((date) => {
          const dayProgress = rowsByDate.progressByDate[date] ?? {};
          const dayItemProgress = rowsByDate.itemByDate[date] ?? {};
          const summary =
            summaryByDate[date] ?? summarizeDay(activeTemplates, dayProgress, dayItemProgress);
          const attempt = rowsByDate.attemptsByDate[date] ?? null;
          const label = DateTime.fromISO(date).toFormat("ccc, LLL d");
          const hasBankedToken = bankedSpinDates.includes(date);

          return (
            <details className="card stack" key={date}>
              <summary className="goal-history-summary">
                <span style={{ fontWeight: 700 }}>{label}</span>
                <span className={summary.done ? "goal-status-ok" : "goal-status-bad"}>
                  {summary.done ? "✅" : "❌"}
                </span>
              </summary>
              <div className="item-sub">
                Completed: {summary.completed}/{summary.total}
              </div>
              {attempt && (
                <div className="item-sub">
                  Reward spin: {attempt.did_win ? `WIN (${attempt.reward_label})` : "MISS"}
                </div>
              )}
              {!attempt && hasBankedToken && (
                <div className="item-sub">Reward spin: Banked token available for this day</div>
              )}
              <div className="divider" />
              {activeTemplates.length === 0 && (
                <div className="item-sub">No active goals configured for this period.</div>
              )}
              {activeTemplates.map((template) => {
                const done = isTemplateCompleted(template, dayProgress, dayItemProgress);
                const progress = dayProgress[template.id];
                return (
                  <div className="item" key={`${date}-${template.id}`}>
                    <div className="item-body">
                      <div className="item-title">{template.title}</div>
                      <div className="item-sub">
                        {template.goal_kind === "number"
                          ? `Value: ${progress?.numeric_value ?? 0} / ${template.target_value}`
                          : template.items.length > 0
                            ? `${template.items.filter((item) => dayItemProgress[item.id]?.checked ?? false).length}/${template.items.length} checklist items`
                            : (progress?.checked ?? false)
                              ? "Checked"
                              : "Not checked"}
                      </div>
                    </div>
                    <div className={done ? "goal-status-ok" : "goal-status-bad"}>
                      {done ? "✅" : "❌"}
                    </div>
                  </div>
                );
              })}
            </details>
          );
        })}

      {error && (
        <div className="card" style={{ color: "#dc2626" }}>
          {error}
        </div>
      )}
      {success && (
        <div className="card" style={{ color: "#16a34a" }}>
          {success}
        </div>
      )}
    </div>
  );
}
