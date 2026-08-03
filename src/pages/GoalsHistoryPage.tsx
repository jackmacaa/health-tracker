import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  countUnredeemedGoalRewards,
  getGoalRewardSettings,
  getGoalRewardTokenBank,
  listGoalRewardAttemptsRange,
  listGoalSecondChanceAttemptsRange,
  redeemGoalRewardsQuantity,
  settleSecondChanceAutoBank,
  spinGoalRewardForToday,
} from "../api/goalRewards";
import {
  listGoalDailyItemProgressRange,
  listGoalDailyNotesRange,
  listGoalDailyProgressRange,
  listGoalTemplatesWithItems,
} from "../api/goals";
import { tzOffsetNowMinutes } from "../lib/date";
import { playWheelSound, startWheelTickTrack } from "../lib/wheelFx";
import SpinWheelCard from "../components/SpinWheelCard";
import {
  getActiveTemplatesForDate,
  isRewardEligible,
  isTemplateCompleted,
  keyByTemplateId,
  keyByTemplateItemId,
  summarizeDay,
  toLocalDateISO,
} from "./goalsUtils";

type RangeOption = "7" | "30" | "all";

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
  const [selectedRange, setSelectedRange] = useState<RangeOption>("7");
  const [redeemQuantity, setRedeemQuantity] = useState("1");
  const [availableRewards, setAvailableRewards] = useState(0);
  const [fractionalBankBalance, setFractionalBankBalance] = useState(0);
  const [rewardSettings, setRewardSettings] =
    useState<Awaited<ReturnType<typeof getGoalRewardSettings>>>(null);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [wheelSoundOn, setWheelSoundOn] = useState(true);
  const [winBurstActive, setWinBurstActive] = useState(false);
  const spinTickStopRef = useRef<(() => void) | null>(null);
  const spinEndTimeoutRef = useRef<number | null>(null);
  const winBurstTimeoutRef = useRef<number | null>(null);
  const settlingRef = useRef(false);

  const [templates, setTemplates] = useState<
    Awaited<ReturnType<typeof listGoalTemplatesWithItems>>
  >([]);
  const [progressRows, setProgressRows] = useState<
    Awaited<ReturnType<typeof listGoalDailyProgressRange>>
  >([]);
  const [itemProgressRows, setItemProgressRows] = useState<
    Awaited<ReturnType<typeof listGoalDailyItemProgressRange>>
  >([]);
  const [noteRows, setNoteRows] = useState<Awaited<ReturnType<typeof listGoalDailyNotesRange>>>([]);
  const [attemptRows, setAttemptRows] = useState<
    Awaited<ReturnType<typeof listGoalRewardAttemptsRange>>
  >([]);
  const [secondChanceRows, setSecondChanceRows] = useState<
    Awaited<ReturnType<typeof listGoalSecondChanceAttemptsRange>>
  >([]);

  const today = DateTime.local();
  const endDate = toLocalDateISO(today);
  const allWindowDays = 3650;
  const startDate = toLocalDateISO(today.minus({ days: allWindowDays - 1 }));

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [
        templateData,
        progressData,
        itemProgressData,
        noteData,
        rewardData,
        secondChanceData,
        availableCount,
        settings,
        tokenBank,
      ] = await Promise.all([
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
        listGoalDailyNotesRange({
          user_id: userId,
          start_local_date: startDate,
          end_local_date: endDate,
        }),
        listGoalRewardAttemptsRange({
          user_id: userId,
          start_local_date: startDate,
          end_local_date: endDate,
        }),
        listGoalSecondChanceAttemptsRange({
          user_id: userId,
          start_local_date: startDate,
          end_local_date: endDate,
        }),
        countUnredeemedGoalRewards(userId),
        getGoalRewardSettings(userId),
        getGoalRewardTokenBank(userId),
      ]);
      setTemplates(templateData);
      setProgressRows(progressData);
      setItemProgressRows(itemProgressData);
      setNoteRows(noteData);
      setAttemptRows(rewardData);
      setSecondChanceRows(secondChanceData);
      setAvailableRewards(availableCount);
      setRewardSettings(settings);
      setFractionalBankBalance(Number(tokenBank?.fractional_balance ?? 0));
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  const allDatesWindow = useMemo(() => {
    return [...Array(allWindowDays)].map((_, index) =>
      toLocalDateISO(today.minus({ days: index })),
    );
  }, [today.toISODate()]);

  const rangeDates = useMemo(() => {
    if (selectedRange === "7") {
      return [...Array(7)].map((_, index) => toLocalDateISO(today.minus({ days: index })));
    }
    if (selectedRange === "30") {
      return [...Array(30)].map((_, index) => toLocalDateISO(today.minus({ days: index })));
    }

    return allDatesWindow;
  }, [selectedRange, today.toISODate(), allDatesWindow]);

  const rowsByDate = useMemo(() => {
    const progressByDate: Record<string, ReturnType<typeof keyByTemplateId>> = {};
    const itemByDate: Record<string, ReturnType<typeof keyByTemplateItemId>> = {};
    const notesByDate: Record<string, (typeof noteRows)[number]> = {};
    const attemptsByDate: Record<string, (typeof attemptRows)[number]> = {};
    const secondChanceByDate: Record<string, (typeof secondChanceRows)[number]> = {};

    allDatesWindow.forEach((date) => {
      const dayProgress = progressRows.filter((row) => row.local_date === date);
      const dayItemProgress = itemProgressRows.filter((row) => row.local_date === date);
      progressByDate[date] = keyByTemplateId(dayProgress);
      itemByDate[date] = keyByTemplateItemId(dayItemProgress);
    });

    noteRows.forEach((note) => {
      notesByDate[note.local_date] = note;
    });

    attemptRows.forEach((attempt) => {
      attemptsByDate[attempt.local_date] = attempt;
    });
    secondChanceRows.forEach((attempt) => {
      secondChanceByDate[attempt.local_date] = attempt;
    });

    return { progressByDate, itemByDate, notesByDate, attemptsByDate, secondChanceByDate };
  }, [allDatesWindow, progressRows, itemProgressRows, noteRows, attemptRows, secondChanceRows]);

  const summaryByDate = useMemo(() => {
    const mapped: Record<string, ReturnType<typeof summarizeDay>> = {};
    allDatesWindow.forEach((date) => {
      const dayProgress = rowsByDate.progressByDate[date] ?? {};
      const dayItemProgress = rowsByDate.itemByDate[date] ?? {};
      mapped[date] = summarizeDay(templates, dayProgress, dayItemProgress, date);
    });
    return mapped;
  }, [allDatesWindow, rowsByDate, templates]);

  useEffect(() => {
    if (loading || settlingRef.current) return;
    if (!rewardSettings?.second_chance_enabled) return;

    const eligibleForAuto = allDatesWindow
      .filter((date) => date !== endDate)
      .filter((date) => {
        if (rowsByDate.secondChanceByDate[date]) return false;
        const summary = summaryByDate[date];
        if (!summary) return false;
        if (!summary.requiredDone) return false;

        const eligibleForMain = isRewardEligible(rewardSettings, summary.completed, summary.total);
        if (eligibleForMain) return false;

        return isRewardEligible(
          {
            ...rewardSettings,
            threshold_mode: rewardSettings.second_chance_threshold_mode,
            threshold_value: rewardSettings.second_chance_threshold_value,
          },
          summary.completed,
          summary.total,
        );
      })
      .map((date) => {
        const summary = summaryByDate[date];
        return {
          local_date: date,
          tz_offset_minutes: tzOffsetNowMinutes(),
          eligible_goal_count: summary.completed,
          total_goal_count: summary.total,
          threshold_mode: rewardSettings.second_chance_threshold_mode,
          threshold_value: rewardSettings.second_chance_threshold_value,
          chance_percent: rewardSettings.second_chance_chance_percent,
          required_goals_completed: summary.requiredDone,
        };
      });

    if (eligibleForAuto.length === 0) return;

    settlingRef.current = true;
    void settleSecondChanceAutoBank({ user_id: userId, entries: eligibleForAuto })
      .then((createdCount) => {
        if (createdCount > 0) {
          void load();
        }
      })
      .catch((e: any) => {
        setError(e.message ?? String(e));
      })
      .finally(() => {
        settlingRef.current = false;
      });
  }, [loading, rewardSettings, allDatesWindow, rowsByDate, summaryByDate, endDate, userId]);

  const bankedSpinDates = useMemo(() => {
    if (!rewardSettings) return [] as string[];

    const dates = allDatesWindow.filter((date) => {
      if (date === endDate) return false;
      if (rowsByDate.attemptsByDate[date]) return false;
      const summary = summaryByDate[date];
      return (
        summary.requiredDone && isRewardEligible(rewardSettings, summary.completed, summary.total)
      );
    });

    return [...dates].sort((a, b) => a.localeCompare(b));
  }, [rewardSettings, allDatesWindow, rowsByDate, summaryByDate, endDate]);

  const oldestBankedSpinDate = bankedSpinDates[0] ?? null;

  const chancePercent = Math.max(0, Math.min(100, rewardSettings?.chance_percent ?? 0));
  const wheelSegmentCount = Math.max(2, Math.min(72, rewardSettings?.wheel_segment_count ?? 12));
  const wheelSectors = useMemo(
    () => buildWheelSectors(chancePercent, wheelSegmentCount),
    [chancePercent, wheelSegmentCount],
  );

  const canRedeem = (() => {
    const parsed = Number(redeemQuantity);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= availableRewards;
  })();

  const displayDates = useMemo(() => {
    if (selectedRange !== "all") return rangeDates;

    return rangeDates.filter((date) => {
      const summary = summaryByDate[date];
      return (
        (summary?.total ?? 0) > 0 ||
        Boolean(rowsByDate.notesByDate[date]) ||
        Boolean(rowsByDate.attemptsByDate[date]) ||
        Boolean(rowsByDate.secondChanceByDate[date])
      );
    });
  }, [selectedRange, rangeDates, summaryByDate, rowsByDate]);

  const topStats = useMemo(() => {
    const scopedDates = displayDates;
    const validSummaries = scopedDates
      .map((date) => summaryByDate[date])
      .filter((summary) => summary && summary.total > 0);

    const avgCompletion =
      validSummaries.length > 0
        ? validSummaries.reduce((acc, summary) => acc + summary.percent, 0) / validSummaries.length
        : 0;

    let longestStreak = 0;
    let currentStreak = 0;
    for (const date of [...scopedDates].sort((a, b) => b.localeCompare(a))) {
      const summary = summaryByDate[date];
      if (summary?.done) {
        currentStreak += 1;
        longestStreak = Math.max(longestStreak, currentStreak);
      } else {
        currentStreak = 0;
      }
    }

    const descDates = [...scopedDates].sort((a, b) => b.localeCompare(a));
    let streakNow = 0;
    for (const date of descDates) {
      const summary = summaryByDate[date];
      if (summary?.done) {
        streakNow += 1;
      } else {
        break;
      }
    }

    const successByGoal: Record<string, number> = {};
    const failByGoal: Record<string, number> = {};
    const requiredPasses = validSummaries.filter((summary) => summary.requiredDone).length;

    scopedDates.forEach((date) => {
      const dayProgress = rowsByDate.progressByDate[date] ?? {};
      const dayItem = rowsByDate.itemByDate[date] ?? {};
      const activeTemplates = getActiveTemplatesForDate(templates, date);
      activeTemplates.forEach((template) => {
        const done = isTemplateCompleted(template, dayProgress, dayItem);
        const title = template.title;
        if (done) {
          successByGoal[title] = (successByGoal[title] ?? 0) + 1;
        } else {
          failByGoal[title] = (failByGoal[title] ?? 0) + 1;
        }
      });
    });

    const mostCommonSuccess = Object.entries(successByGoal).sort((a, b) => b[1] - a[1])[0] ?? null;
    const mostCommonFailure = Object.entries(failByGoal).sort((a, b) => b[1] - a[1])[0] ?? null;

    const rewardWins = attemptRows.filter(
      (attempt) => scopedDates.includes(attempt.local_date) && attempt.did_win,
    ).length;

    return {
      avgCompletion,
      longestStreak,
      streakNow,
      requiredPassRate:
        validSummaries.length > 0 ? (requiredPasses / validSummaries.length) * 100 : 0,
      mostCommonSuccess,
      mostCommonFailure,
      rewardWins,
    };
  }, [displayDates, summaryByDate, rowsByDate, templates, attemptRows]);

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
        required_goals_completed: summary.requiredDone,
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
        <div style={{ fontWeight: 700 }}>Overview</div>
        <div className="row" style={{ gap: "8px", flexWrap: "wrap" }}>
          <button
            className={`btn ${selectedRange === "7" ? "" : "secondary"}`}
            type="button"
            onClick={() => setSelectedRange("7")}
          >
            7 days
          </button>
          <button
            className={`btn ${selectedRange === "30" ? "" : "secondary"}`}
            type="button"
            onClick={() => setSelectedRange("30")}
          >
            30 days
          </button>
          <button
            className={`btn ${selectedRange === "all" ? "" : "secondary"}`}
            type="button"
            onClick={() => setSelectedRange("all")}
          >
            All days
          </button>
        </div>
        <div className="goal-summary-row">
          <div className="goal-pill goal-pill-success">
            Longest streak: {topStats.longestStreak}
          </div>
          <div className="goal-pill">Current streak: {topStats.streakNow}</div>
          <div className="goal-pill">Avg completion: {topStats.avgCompletion.toFixed(1)}%</div>
          <div className="goal-pill">
            Required pass rate: {topStats.requiredPassRate.toFixed(1)}%
          </div>
          <div className="goal-pill">Reward wins: {topStats.rewardWins}</div>
        </div>
        <div className="item-sub">
          Most common success:{" "}
          {topStats.mostCommonSuccess
            ? `${topStats.mostCommonSuccess[0]} (${topStats.mostCommonSuccess[1]})`
            : "Not enough data yet"}
        </div>
        <div className="item-sub">
          Most common failure:{" "}
          {topStats.mostCommonFailure
            ? `${topStats.mostCommonFailure[0]} (${topStats.mostCommonFailure[1]})`
            : "Not enough data yet"}
        </div>
      </div>

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Rewards Wallet</div>
        <div className="goal-summary-row">
          <div className="goal-pill goal-pill-success">Available: {availableRewards}</div>
          <div className="goal-pill">
            Unredeemed fractional bank: {fractionalBankBalance.toFixed(2)}
          </div>
          <div className="goal-pill">Catch-up spin days: {bankedSpinDates.length}</div>
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
          Redemption is whole-token only. Fractions stay banked until they add up to at least 1.
        </div>
      </div>

      <SpinWheelCard
        title="Catch-up Spins"
        description="These are eligible days you did not spin yet. Use them one by one, oldest first."
        segments={wheelSectors}
        colorMode="binary"
        colors={{ win: ["#16a34a", "#22c55e"], lose: ["#ef4444", "#f97316"] }}
        wheelRotation={wheelRotation}
        wheelSpinning={wheelSpinning}
        winBurstActive={winBurstActive}
        buttonLabel="SPIN"
        buttonBusyLabel="..."
        buttonTitle={
          rewardSettings && oldestBankedSpinDate
            ? "Spin oldest catch-up token"
            : "No catch-up spins available yet."
        }
        disabled={saving || wheelSpinning || !rewardSettings || !oldestBankedSpinDate}
        onClick={spinBankedToken}
        legend={
          <>
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
          </>
        }
        footer={
          oldestBankedSpinDate
            ? `Next catch-up spin: ${DateTime.fromISO(oldestBankedSpinDate).toFormat("cccc, LLL d")}`
            : "No catch-up spins right now."
        }
      />

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>History</div>
        <div className="item-sub">
          Green check means all active daily goals were completed for that day.
        </div>
      </div>

      {loading && <div className="card">Loading history...</div>}

      {!loading && displayDates.length === 0 && (
        <div className="card">No history rows in this range yet.</div>
      )}

      {!loading &&
        displayDates.map((date) => {
          const dayProgress = rowsByDate.progressByDate[date] ?? {};
          const dayItemProgress = rowsByDate.itemByDate[date] ?? {};
          const activeTemplatesForDate = getActiveTemplatesForDate(templates, date);
          const summary =
            summaryByDate[date] ?? summarizeDay(templates, dayProgress, dayItemProgress, date);
          const attempt = rowsByDate.attemptsByDate[date] ?? null;
          const secondChance = rowsByDate.secondChanceByDate[date] ?? null;
          const note = rowsByDate.notesByDate[date] ?? null;
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
                Completed: {summary.completed}/{summary.total} ({summary.percent.toFixed(0)}%)
              </div>
              <div className="item-sub">
                Required goals: {summary.requiredCompleted}/{summary.requiredTotal}
              </div>
              {attempt && (
                <div className="item-sub">
                  Reward spin: {attempt.did_win ? `WIN (${attempt.reward_label})` : "MISS"}
                </div>
              )}
              {!attempt && hasBankedToken && (
                <div className="item-sub">Reward spin: Banked token available for this day</div>
              )}
              {secondChance && (
                <div className="item-sub">
                  Second chance:{" "}
                  {secondChance.action === "spin"
                    ? secondChance.did_win
                      ? "SPIN WIN (+1 token)"
                      : "SPIN MISS"
                    : `BANKED +${secondChance.awarded_fraction.toFixed(2)} token`}
                </div>
              )}
              {note && (
                <div className="item-sub" style={{ whiteSpace: "pre-wrap" }}>
                  Note: {note.note_text}
                </div>
              )}
              <div className="divider" />
              {activeTemplatesForDate.length === 0 && (
                <div className="item-sub">No active goals configured for this period.</div>
              )}
              {activeTemplatesForDate.map((template) => {
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
                      {template.required_for_reward && (
                        <div className="item-sub">Required for reward eligibility</div>
                      )}
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
