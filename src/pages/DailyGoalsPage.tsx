import { useEffect, useMemo, useRef, useState } from "react";
import { DateTime } from "luxon";
import {
  getGoalRewardSettings,
  getGoalRewardAttemptByDate,
  spinGoalRewardForToday,
} from "../api/goalRewards";
import {
  listGoalDailyItemProgressByDate,
  listGoalDailyProgressByDate,
  listGoalTemplatesWithItems,
  upsertGoalDailyItemProgress,
  upsertGoalDailyProgress,
} from "../api/goals";
import { tzOffsetNowMinutes } from "../lib/date";
import type { GoalRewardAttempt } from "../types";
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
  const [wheelRotation, setWheelRotation] = useState(0);
  const [wheelSpinning, setWheelSpinning] = useState(false);
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});
  const numberSaveTimersRef = useRef<Record<string, number>>({});

  const localDate = toLocalDateISO(DateTime.local());

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [templateRows, progress, itemProgress, settings, attempt] = await Promise.all([
        listGoalTemplatesWithItems(userId),
        listGoalDailyProgressByDate({ user_id: userId, local_date: localDate }),
        listGoalDailyItemProgressByDate({ user_id: userId, local_date: localDate }),
        getGoalRewardSettings(userId),
        getGoalRewardAttemptByDate({ user_id: userId, local_date: localDate }),
      ]);
      setTemplates(templateRows);
      setProgressRows(progress);
      setItemProgressRows(itemProgress);
      setRewardSettings(settings);
      setRewardAttempt(attempt);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  useEffect(() => {
    return () => {
      Object.values(numberSaveTimersRef.current).forEach((timerId) => {
        window.clearTimeout(timerId);
      });
      numberSaveTimersRef.current = {};
    };
  }, []);

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
    () => isRewardEligible(rewardSettings, summary.completed, summary.total),
    [rewardSettings, summary],
  );

  const chancePercent = Math.max(0, Math.min(100, rewardSettings?.chance_percent ?? 0));
  const chanceDegrees = chancePercent * 3.6;

  const isDayLocked = rewardAttempt != null;

  async function saveCheckboxTemplate(templateId: string, checked: boolean) {
    if (isDayLocked) return;
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

  async function saveNumberTemplate(templateId: string, value: number | null) {
    if (isDayLocked) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertGoalDailyProgress({
        user_id: userId,
        template_id: templateId,
        occurred_at: occurredAtNoonUtc(localDate),
        tz_offset_minutes: tzOffsetNowMinutes(),
        checked: false,
        numeric_value: value,
      });
      setSuccess("Saved.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  function queueSaveNumberTemplate(templateId: string, nextValue: string) {
    const existingTimer = numberSaveTimersRef.current[templateId];
    if (existingTimer != null) {
      window.clearTimeout(existingTimer);
    }

    const timerId = window.setTimeout(() => {
      const parsed = nextValue === "" ? null : Number(nextValue);
      if (parsed != null && (Number.isNaN(parsed) || parsed < 0)) return;

      void saveNumberTemplate(templateId, parsed == null ? null : Math.floor(parsed));

      setNumberDrafts((current) => {
        if (current[templateId] !== nextValue) return current;
        const { [templateId]: _, ...rest } = current;
        return rest;
      });

      delete numberSaveTimersRef.current[templateId];
    }, 450);

    numberSaveTimersRef.current[templateId] = timerId;
  }

  async function toggleChecklistItem(templateId: string, itemId: string, checked: boolean) {
    if (isDayLocked) return;
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
          return nextItemMap[item.id]?.checked ?? false;
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

  async function spinReward() {
    if (!rewardSettings) {
      setError("Configure reward settings first in Goals Setup.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const attempt = await spinGoalRewardForToday({
        user_id: userId,
        local_date: localDate,
        tz_offset_minutes: tzOffsetNowMinutes(),
        settings: rewardSettings,
        eligible_goal_count: summary.completed,
        total_goal_count: summary.total,
      });

      // Rotate to the actual rolled segment so the pointer matches WIN/MISS.
      const rolledPercent = Math.max(0, Math.min(99.999, attempt.rolled_value));
      const desiredPointerAngle = rolledPercent * 3.6;
      setWheelSpinning(true);
      setWheelRotation((prev) => {
        const currentNormalized = ((prev % 360) + 360) % 360;
        const finalNormalized = (360 - desiredPointerAngle) % 360;
        const deltaNormalized = (finalNormalized - currentNormalized + 360) % 360;
        const spinDegrees = 3600 + deltaNormalized;
        return prev + spinDegrees;
      });

      setRewardAttempt(attempt);
      setSuccess(attempt.did_win ? `You won: ${attempt.reward_label}` : "No win this time.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      window.setTimeout(() => setWheelSpinning(false), 4200);
      setSaving(false);
    }
  }

  const activeTemplates = templates.filter((template) => template.active);

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
          <div className={`goal-pill ${isDayLocked ? "goal-pill-fail" : "goal-pill-success"}`}>
            {isDayLocked ? "Locked after spin" : "Editable"}
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
                      ? `Target: ${template.target_value}`
                      : template.items.length > 0
                        ? `Checklist: ${template.items.length} items`
                        : "Single checkbox"}
                  </div>
                </div>
                <div className={completed ? "goal-status-ok" : "goal-status-bad"}>
                  {completed ? "✅" : "❌"}
                </div>
              </div>

              {template.goal_kind === "number" && (
                <div className="row" style={{ gap: "8px" }}>
                  <input
                    type="number"
                    min="0"
                    step="1"
                    value={numberDrafts[template.id] ?? String(progress?.numeric_value ?? "")}
                    placeholder="0"
                    disabled={saving || isDayLocked}
                    onChange={(e) => {
                      const next = e.target.value;
                      if (next !== "" && !/^\d+$/.test(next)) return;
                      setNumberDrafts((current) => ({ ...current, [template.id]: next }));
                      queueSaveNumberTemplate(template.id, next);
                    }}
                  />
                </div>
              )}

              {template.goal_kind === "checkbox" && template.items.length === 0 && (
                <button
                  className={`btn ${progress?.checked ? "secondary" : ""}`}
                  type="button"
                  disabled={saving || isDayLocked}
                  onClick={() => saveCheckboxTemplate(template.id, !(progress?.checked ?? false))}
                >
                  {progress?.checked ? "Marked done" : "Mark done"}
                </button>
              )}

              {template.goal_kind === "checkbox" && template.items.length > 0 && (
                <div className="chips">
                  {template.items.map((item) => {
                    const checked = itemProgressByItemId[item.id]?.checked ?? false;
                    return (
                      <button
                        key={item.id}
                        className={`chip ${checked ? "active" : ""}`}
                        type="button"
                        disabled={saving || isDayLocked}
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
        <div style={{ fontWeight: 700 }}>Reward Spin</div>
        <div className="goal-wheel-wrap">
          <div className="goal-wheel-pointer" />
          <div
            className={`goal-wheel ${wheelSpinning ? "is-spinning" : ""}`}
            style={{
              transform: `rotate(${wheelRotation}deg)`,
              background: `conic-gradient(#16a34a 0deg ${chanceDegrees}deg, #ef4444 ${chanceDegrees}deg 360deg)`,
            }}
          >
            <span className="goal-wheel-center">SPIN</span>
          </div>
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
            </div>
            <div className="item-sub">
              Unlock rule: {rewardSettings.threshold_mode === "count" ? "count" : "percent"} ≥{" "}
              {rewardSettings.threshold_value}
            </div>
            {rewardAttempt ? (
              <div className="goal-attempt-box">
                Spin already used today: {rewardAttempt.did_win ? "WIN" : "MISS"}
              </div>
            ) : (
              <button
                className="btn"
                type="button"
                disabled={!eligibleForReward || saving || isDayLocked}
                onClick={spinReward}
              >
                {wheelSpinning
                  ? "Spinning..."
                  : eligibleForReward
                    ? "Spin reward"
                    : "Complete more goals to unlock spin"}
              </button>
            )}
          </>
        )}
      </div>

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
