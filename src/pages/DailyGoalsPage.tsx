import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  bankSecondChanceForDate,
  getGoalRewardSettings,
  getGoalRewardAttemptByDate,
  getGoalSecondChanceAttemptByDate,
  spinSecondChanceForDate,
  spinGoalRewardForToday,
} from "../api/goalRewards";
import {
  deleteGoalDailyNoteByDate,
  getGoalDailyNoteByDate,
  listGoalDailyItemProgressByDate,
  listGoalDailyProgressByDate,
  listGoalTemplatesWithItems,
  upsertGoalDailyNote,
  upsertGoalDailyItemProgress,
  upsertGoalDailyProgress,
} from "../api/goals";
import { tzOffsetNowMinutes } from "../lib/date";
import { playWheelSound, startWheelTickTrack } from "../lib/wheelFx";
import type { GoalRewardAttempt, GoalSecondChanceAttempt } from "../types";
import {
  occurredAtNoonUtc,
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

function buildAlternatingWheelGradient(
  sectors: WheelSector[],
  colors: { win: [string, string]; lose: [string, string] },
) {
  return `conic-gradient(${sectors
    .map((sector, index) => {
      const palette = sector.win ? colors.win : colors.lose;
      const color = palette[index % 2];
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

export default function DailyGoalsPage({ userId }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [templates, setTemplates] = useState<
    Awaited<ReturnType<typeof listGoalTemplatesWithItems>>
  >([]);
  const [progressRows, setProgressRows] = useState<
    Awaited<ReturnType<typeof listGoalDailyProgressByDate>>
  >([]);
  const [itemProgressRows, setItemProgressRows] = useState<
    Awaited<ReturnType<typeof listGoalDailyItemProgressByDate>>
  >([]);
  const [rewardSettings, setRewardSettings] =
    useState<Awaited<ReturnType<typeof getGoalRewardSettings>>>(null);
  const [rewardAttempt, setRewardAttempt] = useState<GoalRewardAttempt | null>(null);
  const [secondChanceAttempt, setSecondChanceAttempt] = useState<GoalSecondChanceAttempt | null>(
    null,
  );
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const [dailyNoteDraft, setDailyNoteDraft] = useState("");
  const [dailyNoteSaved, setDailyNoteSaved] = useState("");
  const [noteSaving, setNoteSaving] = useState(false);
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [winBurstActive, setWinBurstActive] = useState(false);
  const [secondChanceRotation, setSecondChanceRotation] = useState(0);
  const [secondChanceSpinning, setSecondChanceSpinning] = useState(false);
  const [secondChanceWinBurstActive, setSecondChanceWinBurstActive] = useState(false);
  const spinTickStopRef = useRef<(() => void) | null>(null);
  const spinEndTimeoutRef = useRef<number | null>(null);
  const spinBurstTimeoutRef = useRef<number | null>(null);
  const secondChanceTickStopRef = useRef<(() => void) | null>(null);
  const secondChanceEndTimeoutRef = useRef<number | null>(null);
  const secondChanceBurstTimeoutRef = useRef<number | null>(null);

  const localDate = toLocalDateISO(DateTime.local());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [templateRows, progress, itemProgress, settings, attempt, secondChance, note] =
        await Promise.all([
          listGoalTemplatesWithItems(userId),
          listGoalDailyProgressByDate({ user_id: userId, local_date: localDate }),
          listGoalDailyItemProgressByDate({ user_id: userId, local_date: localDate }),
          getGoalRewardSettings(userId),
          getGoalRewardAttemptByDate({ user_id: userId, local_date: localDate }),
          getGoalSecondChanceAttemptByDate({ user_id: userId, local_date: localDate }),
          getGoalDailyNoteByDate({ user_id: userId, local_date: localDate }),
        ]);
      setTemplates(templateRows);
      setProgressRows(progress);
      setItemProgressRows(itemProgress);
      setRewardSettings(settings);
      setRewardAttempt(attempt);
      setSecondChanceAttempt(secondChance);
      setDailyNoteDraft(note?.note_text ?? "");
      setDailyNoteSaved(note?.note_text ?? "");
      setNumberDrafts({});
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  const progressByTemplateId = useMemo(() => keyByTemplateId(progressRows), [progressRows]);
  const itemProgressByItemId = useMemo(
    () => keyByTemplateItemId(itemProgressRows),
    [itemProgressRows],
  );

  const summary = useMemo(
    () => summarizeDay(templates, progressByTemplateId, itemProgressByItemId),
    [templates, progressByTemplateId, itemProgressByItemId],
  );

  const eligibleForReward = useMemo(
    () =>
      isRewardEligible(rewardSettings, summary.completed, summary.total) && summary.requiredDone,
    [rewardSettings, summary],
  );

  const secondChanceEligible = useMemo(() => {
    if (!rewardSettings?.second_chance_enabled) return false;
    if (eligibleForReward) return false;
    if (!summary.requiredDone) return false;

    return isRewardEligible(
      {
        ...rewardSettings,
        threshold_mode: rewardSettings.second_chance_threshold_mode,
        threshold_value: rewardSettings.second_chance_threshold_value,
      },
      summary.completed,
      summary.total,
    );
  }, [rewardSettings, summary, eligibleForReward]);

  const chancePercent = Math.max(0, Math.min(100, rewardSettings?.chance_percent ?? 0));
  const wheelSegmentCount = Math.max(2, Math.min(72, rewardSettings?.wheel_segment_count ?? 12));
  const wheelSectors = useMemo(
    () => buildWheelSectors(chancePercent, wheelSegmentCount),
    [chancePercent, wheelSegmentCount],
  );
  const wheelGradient = useMemo(() => buildWheelGradient(wheelSectors), [wheelSectors]);
  const secondChanceChancePercent = Math.max(
    0,
    Math.min(100, rewardSettings?.second_chance_chance_percent ?? 10),
  );
  const secondChanceSectors = useMemo(
    () => buildWheelSectors(secondChanceChancePercent, wheelSegmentCount),
    [secondChanceChancePercent, wheelSegmentCount],
  );
  const secondChanceGradient = useMemo(
    () =>
      buildAlternatingWheelGradient(secondChanceSectors, {
        win: ["#2563eb", "#3b82f6"],
        lose: ["#f59e0b", "#fbbf24"],
      }),
    [secondChanceSectors],
  );
  const allGoalsCompleted = summary.total > 0 && summary.done;

  const isChecklistLocked = rewardAttempt != null || secondChanceAttempt != null;
  const canSpinToday = Boolean(rewardSettings) && eligibleForReward && !rewardAttempt;
  const canUseSecondChanceToday =
    Boolean(rewardSettings?.second_chance_enabled) && secondChanceEligible && !secondChanceAttempt;
  const secondChanceLockReason = useMemo(() => {
    if (!rewardSettings?.second_chance_enabled) {
      return "Enable second chance in Goals Setup.";
    }
    if (secondChanceAttempt) {
      return "Second chance already used for today.";
    }
    if (!summary.requiredDone) {
      return "Complete required goals to unlock second chance.";
    }
    if (eligibleForReward) {
      return "Main reward spin is unlocked instead.";
    }
    if (!secondChanceEligible) {
      return "Reach the second chance threshold to unlock.";
    }
    return null;
  }, [
    rewardSettings,
    secondChanceAttempt,
    summary.requiredDone,
    eligibleForReward,
    secondChanceEligible,
  ]);
  const showRewardWheel =
    !rewardSettings ||
    !rewardSettings.second_chance_enabled ||
    eligibleForReward ||
    rewardAttempt != null;
  const showSecondChanceWheel = Boolean(rewardSettings?.second_chance_enabled) && !showRewardWheel;

  const activeTemplates = useMemo(() => {
    const active = templates.filter((template) => template.active);

    return [...active].sort((a, b) => {
      if (a.display_order !== b.display_order) {
        return a.display_order - b.display_order;
      }

      return a.title.localeCompare(b.title);
    });
  }, [templates]);

  useEffect(() => {
    return () => {
      spinTickStopRef.current?.();
      if (spinEndTimeoutRef.current != null) {
        window.clearTimeout(spinEndTimeoutRef.current);
      }
      if (spinBurstTimeoutRef.current != null) {
        window.clearTimeout(spinBurstTimeoutRef.current);
      }
      secondChanceTickStopRef.current?.();
      if (secondChanceEndTimeoutRef.current != null) {
        window.clearTimeout(secondChanceEndTimeoutRef.current);
      }
      if (secondChanceBurstTimeoutRef.current != null) {
        window.clearTimeout(secondChanceBurstTimeoutRef.current);
      }
    };
  }, []);

  async function spinTodayReward() {
    if (!rewardSettings) {
      setError("Set up a reward in Goals Setup first.");
      return;
    }
    if (rewardAttempt) {
      setError("Reward spin already used for this day.");
      return;
    }
    if (!eligibleForReward) {
      setError("Complete more goals to unlock today's spin.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    setWinBurstActive(false);
    let didCreateAttempt = false;
    let didWinResult = false;
    let rewardLabelText = rewardSettings.reward_label;
    try {
      const attempt = await spinGoalRewardForToday({
        user_id: userId,
        local_date: localDate,
        tz_offset_minutes: tzOffsetNowMinutes(),
        settings: rewardSettings,
        eligible_goal_count: summary.completed,
        total_goal_count: summary.total,
        required_goals_completed: summary.requiredDone,
      });
      didCreateAttempt = true;
      didWinResult = attempt.did_win;
      rewardLabelText = attempt.reward_label;

      const desiredPointerAngle = pickLandingAngle({
        sectors: wheelSectors,
        didWin: attempt.did_win,
        rolledPercent: attempt.rolled_value,
      });

      setWheelSpinning(true);
      playWheelSound("start", true);
      spinTickStopRef.current?.();
      spinTickStopRef.current = startWheelTickTrack(4000, true);
      setWheelRotation((prev) => {
        const currentNormalized = ((prev % 360) + 360) % 360;
        const finalNormalized = (360 - desiredPointerAngle) % 360;
        const deltaNormalized = (finalNormalized - currentNormalized + 360) % 360;
        const spinDegrees = 3600 + deltaNormalized;
        return prev + spinDegrees;
      });
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
        playWheelSound(didWinResult ? "win" : "miss", true);
        setSuccess(didWinResult ? `Today's spin: WIN (${rewardLabelText})` : "Today's spin: MISS");
        if (didWinResult) {
          setWinBurstActive(true);
          if (spinBurstTimeoutRef.current != null) {
            window.clearTimeout(spinBurstTimeoutRef.current);
          }
          spinBurstTimeoutRef.current = window.setTimeout(() => {
            setWinBurstActive(false);
          }, 1100);
        } else {
          setWinBurstActive(false);
        }
        void load();
      }, 4200);
      setSaving(false);
    }
  }

  async function spinSecondChanceToday() {
    if (!rewardSettings?.second_chance_enabled) {
      setError("Enable second chance in Goals Setup first.");
      return;
    }
    if (secondChanceAttempt) {
      setError("Second chance already used for today.");
      return;
    }
    if (!secondChanceEligible) {
      setError("Complete more goals to unlock second chance.");
      return;
    }
    const confirmed = window.confirm(
      "Use second chance now? This locks today's checklists and may prevent reaching the main reward spin later.",
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    setSecondChanceWinBurstActive(false);
    let didCreateAttempt = false;
    let didWinResult = false;
    let secondChanceLabelText = rewardSettings.second_chance_label;
    try {
      const attempt = await spinSecondChanceForDate({
        user_id: userId,
        local_date: localDate,
        tz_offset_minutes: tzOffsetNowMinutes(),
        settings: rewardSettings,
        eligible_goal_count: summary.completed,
        total_goal_count: summary.total,
        required_goals_completed: summary.requiredDone,
      });
      didCreateAttempt = true;
      didWinResult = attempt.did_win;
      secondChanceLabelText = rewardSettings.second_chance_label;

      const desiredPointerAngle = pickLandingAngle({
        sectors: secondChanceSectors,
        didWin: attempt.did_win,
        rolledPercent: attempt.rolled_value ?? 0,
      });

      setSecondChanceSpinning(true);
      playWheelSound("start", true);
      secondChanceTickStopRef.current?.();
      secondChanceTickStopRef.current = startWheelTickTrack(3200, true);
      setSecondChanceRotation((prev) => {
        const currentNormalized = ((prev % 360) + 360) % 360;
        const finalNormalized = (360 - desiredPointerAngle) % 360;
        const deltaNormalized = (finalNormalized - currentNormalized + 360) % 360;
        const spinDegrees = 2880 + deltaNormalized;
        return prev + spinDegrees;
      });
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      if (!didCreateAttempt) {
        secondChanceTickStopRef.current?.();
        setSecondChanceSpinning(false);
        setSecondChanceWinBurstActive(false);
        setSaving(false);
        return;
      }

      if (secondChanceEndTimeoutRef.current != null) {
        window.clearTimeout(secondChanceEndTimeoutRef.current);
      }
      secondChanceEndTimeoutRef.current = window.setTimeout(() => {
        setSecondChanceSpinning(false);
        secondChanceTickStopRef.current?.();
        playWheelSound(didWinResult ? "win" : "miss", true);
        setSuccess(
          didWinResult
            ? `${secondChanceLabelText}: WIN (+1 token)`
            : `${secondChanceLabelText}: MISS`,
        );
        if (didWinResult) {
          setSecondChanceWinBurstActive(true);
          if (secondChanceBurstTimeoutRef.current != null) {
            window.clearTimeout(secondChanceBurstTimeoutRef.current);
          }
          secondChanceBurstTimeoutRef.current = window.setTimeout(() => {
            setSecondChanceWinBurstActive(false);
          }, 1100);
        } else {
          setSecondChanceWinBurstActive(false);
        }
        void load();
      }, 3400);
      setSaving(false);
    }
  }

  async function bankSecondChanceToday() {
    if (!rewardSettings?.second_chance_enabled) {
      setError("Enable second chance in Goals Setup first.");
      return;
    }
    if (secondChanceAttempt) {
      setError("Second chance already used for today.");
      return;
    }
    if (!secondChanceEligible) {
      setError("Complete more goals to unlock second chance.");
      return;
    }
    const confirmed = window.confirm(
      "Bank second chance now? This locks today's checklists and may prevent reaching the main reward spin later.",
    );
    if (!confirmed) {
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const attempt = await bankSecondChanceForDate({
        user_id: userId,
        local_date: localDate,
        tz_offset_minutes: tzOffsetNowMinutes(),
        settings: rewardSettings,
        eligible_goal_count: summary.completed,
        total_goal_count: summary.total,
        required_goals_completed: summary.requiredDone,
      });
      setSuccess(
        `${rewardSettings.second_chance_label}: banked +${attempt.awarded_fraction.toFixed(2)} token`,
      );
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveCheckboxTemplate(templateId: string, checked: boolean) {
    if (isChecklistLocked) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertGoalDailyProgress({
        user_id: userId,
        template_id: templateId,
        occurred_at: occurredAtNoonUtc(localDate),
        tz_offset_minutes: tzOffsetNowMinutes(),
        checked,
        numeric_value: null,
      });
      setSuccess("Saved.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveDailyNote() {
    const trimmed = dailyNoteDraft.trim();
    if (!trimmed) {
      setError("Daily note cannot be empty.");
      return;
    }

    setNoteSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await upsertGoalDailyNote({
        user_id: userId,
        occurred_at: occurredAtNoonUtc(localDate),
        tz_offset_minutes: tzOffsetNowMinutes(),
        note_text: trimmed,
      });
      setDailyNoteDraft(saved.note_text);
      setDailyNoteSaved(saved.note_text);
      setSuccess("Note saved.");
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setNoteSaving(false);
    }
  }

  async function clearDailyNote() {
    const hasAnyText = dailyNoteDraft.trim().length > 0 || dailyNoteSaved.trim().length > 0;
    if (!hasAnyText) return;

    const confirmed = window.confirm("Clear today's note?");
    if (!confirmed) return;

    setNoteSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteGoalDailyNoteByDate({
        user_id: userId,
        local_date: localDate,
      });
      setDailyNoteDraft("");
      setDailyNoteSaved("");
      setSuccess("Note cleared.");
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setNoteSaving(false);
    }
  }

  async function saveNumberTemplate(templateId: string, value: number | null) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const saved = await upsertGoalDailyProgress({
        user_id: userId,
        template_id: templateId,
        occurred_at: occurredAtNoonUtc(localDate),
        tz_offset_minutes: tzOffsetNowMinutes(),
        checked: false,
        numeric_value: value,
      });

      setProgressRows((current) => {
        const index = current.findIndex((row) => row.template_id === templateId);
        if (index < 0) return [...current, saved];
        const next = [...current];
        next[index] = saved;
        return next;
      });
      setNumberDrafts((current) => {
        const { [templateId]: _, ...rest } = current;
        return rest;
      });
      setSuccess("Saved.");
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleChecklistItem(templateId: string, itemId: string, checked: boolean) {
    if (isChecklistLocked) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const occurredAt = occurredAtNoonUtc(localDate);
      const tzOffset = tzOffsetNowMinutes();
      await upsertGoalDailyItemProgress({
        user_id: userId,
        template_item_id: itemId,
        occurred_at: occurredAt,
        tz_offset_minutes: tzOffset,
        checked,
      });

      const template = templates.find((row) => row.id === templateId);
      const nextItemMap = { ...itemProgressByItemId, [itemId]: { checked } as any };
      const allDone =
        template?.items.length &&
        template.items.every((item) => {
          if (item.id === itemId) return checked;
          return nextItemMap[item.id]?.checked ?? item.default_checked;
        });

      await upsertGoalDailyProgress({
        user_id: userId,
        template_id: templateId,
        occurred_at: occurredAt,
        tz_offset_minutes: tzOffset,
        checked: Boolean(allDone),
        numeric_value: null,
      });

      setSuccess("Saved.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  const rewardCard = (
    <div className="card stack">
      <div style={{ fontWeight: 700 }}>Reward Spin</div>
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
            disabled={saving || wheelSpinning || !canSpinToday}
            title={
              canSpinToday
                ? "Spin reward wheel"
                : "Reward spin is locked until you meet today's threshold."
            }
            onClick={spinTodayReward}
          >
            {wheelSpinning ? "..." : canSpinToday ? "SPIN" : "LOCKED"}
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
      {!rewardSettings && (
        <div className="item-sub">Set up a reward in Goals Setup to enable spinning.</div>
      )}
      {rewardSettings && (
        <>
          <div className="item-sub">
            Reward: {rewardSettings.reward_label} · Chance: {rewardSettings.chance_percent}%
          </div>
          <div className="goal-wheel-legend">
            <span className="goal-wheel-legend-win">Win zone: {chancePercent.toFixed(1)}%</span>
            <span className="goal-wheel-legend-miss">
              Miss zone: {(100 - chancePercent).toFixed(1)}%
            </span>
            <span className="goal-wheel-legend-miss">Segments: {wheelSegmentCount}</span>
          </div>
          <div className="item-sub">
            Unlock rule: {rewardSettings.threshold_mode === "count" ? "count" : "percent"} ≥{" "}
            {rewardSettings.threshold_value}
          </div>
          <div className="item-sub">
            Required goals: {summary.requiredCompleted}/{summary.requiredTotal}
          </div>
          {rewardAttempt ? (
            <div className="goal-attempt-box">
              Today's spin already used: {rewardAttempt.did_win ? "WIN" : "MISS"}
            </div>
          ) : (
            <div className="goal-attempt-box">
              {eligibleForReward
                ? "Today's spin is unlocked. Press the wheel center to spin now."
                : "Complete more goals to unlock today's spin."}
            </div>
          )}
        </>
      )}
    </div>
  );

  const secondChanceCard = rewardSettings?.second_chance_enabled && (
    <div className="card stack">
      <div style={{ fontWeight: 700 }}>{rewardSettings.second_chance_label}</div>
      <div className="item-sub">
        Finish strong mode: this unlocks when you miss the main reward threshold but still hit your
        configured second chance threshold.
      </div>
      <div className="item-sub" style={{ color: "#991b1b" }}>
        Using second chance locks today's checklists. If you are still close to the main threshold,
        you may want to finish goals first.
      </div>
      <div
        className={`goal-wheel-wrap goal-wheel-wrap-bonus ${secondChanceWinBurstActive ? "is-win-burst" : ""}`}
      >
        <div
          className={`goal-wheel-pointer goal-wheel-pointer-bonus ${secondChanceSpinning ? "is-ticking" : ""}`}
        />
        <div
          className={`goal-wheel goal-wheel-bonus ${secondChanceSpinning ? "is-spinning" : ""}`}
          style={{
            transform: `rotate(${secondChanceRotation}deg)`,
            background: secondChanceGradient,
          }}
        >
          <button
            className="goal-wheel-center goal-wheel-center-bonus"
            type="button"
            disabled={saving || secondChanceSpinning || !canUseSecondChanceToday}
            title={
              canUseSecondChanceToday
                ? "Spin second chance wheel"
                : (secondChanceLockReason ?? "Second chance is not unlocked yet.")
            }
            onClick={spinSecondChanceToday}
          >
            {secondChanceSpinning ? "..." : canUseSecondChanceToday ? "TRY" : "LOCKED"}
          </button>
        </div>
        {secondChanceWinBurstActive && (
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
        <span className="goal-wheel-legend-win">
          Win zone: {secondChanceChancePercent.toFixed(1)}%
        </span>
        <span className="goal-wheel-legend-miss">
          Bank value: {(secondChanceChancePercent / 100).toFixed(2)} token
        </span>
        <span className="goal-wheel-legend-miss">Segments: {wheelSegmentCount}</span>
      </div>
      <div className="row" style={{ gap: "8px" }}>
        <button
          className="btn secondary"
          type="button"
          disabled={saving || secondChanceSpinning || !canUseSecondChanceToday}
          title={
            canUseSecondChanceToday
              ? "Bank second chance value"
              : (secondChanceLockReason ?? "Second chance bank is not unlocked yet.")
          }
          onClick={bankSecondChanceToday}
        >
          {canUseSecondChanceToday ? "Bank Instead" : "Bank Locked"}
        </button>
      </div>
      {!canUseSecondChanceToday && !secondChanceAttempt && (
        <div className="item-sub" style={{ color: "#92400e" }}>
          Locked: {secondChanceLockReason ?? "Second chance is not unlocked yet."}
        </div>
      )}
      {secondChanceAttempt ? (
        <div className="goal-attempt-box">
          Today's result:{" "}
          {secondChanceAttempt.action === "spin"
            ? secondChanceAttempt.did_win
              ? "SPIN WIN (+1 token)"
              : "SPIN MISS"
            : `BANKED +${secondChanceAttempt.awarded_fraction.toFixed(2)} token`}
        </div>
      ) : (
        <div className="goal-attempt-box">
          {canUseSecondChanceToday
            ? "You unlocked second chance. Spin for +1 token or bank the expected value now."
            : "Unlock by reaching second chance threshold and completing required goals."}
        </div>
      )}
    </div>
  );

  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Daily Goals</div>
        <div className="item-sub">{DateTime.fromISO(localDate).toFormat("cccc, LLL d")}</div>
        <div className="goal-summary-row">
          <div className="goal-pill">
            Done: {summary.completed}/{summary.total}
          </div>
          <div className="goal-pill">{summary.percent.toFixed(0)}%</div>
          <div className={`goal-pill ${summary.done ? "goal-pill-success" : "goal-pill-fail"}`}>
            {summary.done ? "Overall: Complete" : "Overall: In Progress"}
          </div>
          <div
            className={`goal-pill ${summary.requiredDone ? "goal-pill-success" : "goal-pill-fail"}`}
          >
            Required: {summary.requiredCompleted}/{summary.requiredTotal}
          </div>
          <div
            className={`goal-pill ${isChecklistLocked ? "goal-pill-fail" : "goal-pill-success"}`}
          >
            {isChecklistLocked ? "Checkboxes locked after spin" : "Fully editable"}
          </div>
        </div>
      </div>

      {loading && <div className="card">Loading goals...</div>}

      {!loading && activeTemplates.length === 0 && (
        <div className="card">
          No active goals yet. Go to Goals Setup and create your first daily goal.
        </div>
      )}

      {!loading &&
        activeTemplates.map((template) => {
          const completed = isTemplateCompleted(
            template,
            progressByTemplateId,
            itemProgressByItemId,
          );
          const progress = progressByTemplateId[template.id];
          return (
            <div className="card stack" key={template.id}>
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 700 }}>{template.title}</div>
                  <div className="item-sub">
                    {template.goal_kind === "number"
                      ? `Value: ${progress?.numeric_value ?? 0} / Target: ${template.target_value}`
                      : template.items.length > 0
                        ? `Checklist: ${template.items.length} items`
                        : "Single checkbox"}
                  </div>
                  {template.required_for_reward && (
                    <div className="item-sub">Required for reward eligibility</div>
                  )}
                </div>
                <div className={completed ? "goal-status-ok" : "goal-status-bad"}>
                  {completed ? "✅" : "❌"}
                </div>
              </div>

              {template.goal_kind === "number" && (
                <div className="row goal-number-row" style={{ gap: "8px" }}>
                  {(() => {
                    const persistedTotal = progress?.numeric_value ?? 0;
                    const draftValue = numberDrafts[template.id] ?? String(persistedTotal);
                    const parsedValue = draftValue === "" ? null : Number(draftValue);
                    const validValue =
                      parsedValue != null && Number.isInteger(parsedValue) && parsedValue >= 0;
                    return (
                      <>
                        <button
                          className="btn secondary"
                          type="button"
                          disabled={saving || persistedTotal <= 0}
                          onClick={() => void saveNumberTemplate(template.id, persistedTotal - 1)}
                        >
                          -
                        </button>
                        <input
                          type="number"
                          min="0"
                          step="1"
                          value={draftValue}
                          placeholder="0"
                          disabled={saving}
                          onChange={(e) => {
                            const next = e.target.value;
                            if (next !== "" && !/^\d+$/.test(next)) return;
                            setNumberDrafts((current) => ({ ...current, [template.id]: next }));
                          }}
                        />
                        <button
                          className="btn secondary"
                          type="button"
                          disabled={saving}
                          onClick={() => {
                            void saveNumberTemplate(template.id, persistedTotal + 1);
                          }}
                        >
                          +
                        </button>
                        <button
                          className="btn secondary"
                          type="button"
                          disabled={saving || !validValue || parsedValue === persistedTotal}
                          onClick={() => {
                            if (!validValue) return;
                            void saveNumberTemplate(template.id, parsedValue);
                          }}
                        >
                          Save
                        </button>
                      </>
                    );
                  })()}
                </div>
              )}

              {template.goal_kind === "checkbox" &&
                template.items.length === 0 &&
                (() => {
                  const checked = progress?.checked ?? template.default_checked;
                  return (
                    <button
                      className={`btn ${checked ? "secondary" : ""}`}
                      type="button"
                      disabled={saving || isChecklistLocked}
                      onClick={() => saveCheckboxTemplate(template.id, !checked)}
                    >
                      {checked ? "Marked done" : "Mark done"}
                    </button>
                  );
                })()}

              {template.goal_kind === "checkbox" && template.items.length > 0 && (
                <div className="chips">
                  {template.items.map((item) => {
                    const checked = itemProgressByItemId[item.id]?.checked ?? item.default_checked;
                    return (
                      <button
                        key={item.id}
                        className={`chip ${checked ? "active" : ""}`}
                        type="button"
                        disabled={saving || isChecklistLocked}
                        onClick={() => toggleChecklistItem(template.id, item.id, !checked)}
                      >
                        {checked ? "✅" : "⬜"} {item.label}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })}

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Daily Notes</div>
        <div className="item-sub">Write a short note for today.</div>
        <textarea
          value={dailyNoteDraft}
          onChange={(e) => setDailyNoteDraft(e.target.value)}
          placeholder="How did today go?"
          maxLength={2000}
          disabled={noteSaving}
        />
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div className="item-sub">{dailyNoteDraft.trim().length}/2000</div>
          <div className="row" style={{ gap: "8px" }}>
            <button
              className="btn secondary"
              type="button"
              disabled={
                noteSaving ||
                (dailyNoteDraft.trim().length === 0 && dailyNoteSaved.trim().length === 0)
              }
              onClick={() => void clearDailyNote()}
            >
              {noteSaving ? "..." : "Clear"}
            </button>
            <button
              className="btn secondary"
              type="button"
              disabled={
                noteSaving ||
                dailyNoteDraft.trim().length === 0 ||
                dailyNoteDraft === dailyNoteSaved
              }
              onClick={() => void saveDailyNote()}
            >
              {noteSaving ? "Saving..." : "Save note"}
            </button>
          </div>
        </div>
      </div>

      {showRewardWheel && rewardCard}

      {showSecondChanceWheel && secondChanceCard}

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
