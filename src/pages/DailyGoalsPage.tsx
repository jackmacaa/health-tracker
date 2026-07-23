import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import { getGoalRewardSettings, getGoalRewardAttemptByDate } from "../api/goalRewards";
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
  const [numberDrafts, setNumberDrafts] = useState<Record<string, string>>({});

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
    () => isRewardEligible(rewardSettings, summary.completed, summary.total),
    [rewardSettings, summary],
  );

  const chancePercent = Math.max(0, Math.min(100, rewardSettings?.chance_percent ?? 0));
  const wheelSegmentCount = Math.max(2, Math.min(72, rewardSettings?.wheel_segment_count ?? 12));
  const wheelSectors = useMemo(
    () => buildWheelSectors(chancePercent, wheelSegmentCount),
    [chancePercent, wheelSegmentCount],
  );
  const wheelGradient = useMemo(() => buildWheelGradient(wheelSectors), [wheelSectors]);
  const allGoalsCompleted = summary.total > 0 && summary.done;

  const isChecklistLocked = rewardAttempt != null;

  const activeTemplates = useMemo(() => {
    const active = templates.filter((template) => template.active);

    return [...active].sort((a, b) => {
      const aDone = isTemplateCompleted(a, progressByTemplateId, itemProgressByItemId);
      const bDone = isTemplateCompleted(b, progressByTemplateId, itemProgressByItemId);

      if (aDone !== bDone) {
        return Number(aDone) - Number(bDone);
      }

      return a.title.localeCompare(b.title);
    });
  }, [templates, progressByTemplateId, itemProgressByItemId]);

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
      <div className="goal-wheel-wrap">
        <div className="goal-wheel-pointer" />
        <div
          className="goal-wheel"
          style={{
            background: wheelGradient,
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
            <span className="goal-wheel-legend-miss">Segments: {wheelSegmentCount}</span>
          </div>
          <div className="item-sub">
            Unlock rule: {rewardSettings.threshold_mode === "count" ? "count" : "percent"} ≥{" "}
            {rewardSettings.threshold_value}
          </div>
          {rewardAttempt ? (
            <div className="goal-attempt-box">
              Today's spin already used: {rewardAttempt.did_win ? "WIN" : "MISS"}
            </div>
          ) : (
            <div className="goal-attempt-box">
              {eligibleForReward
                ? "Today qualifies for a spin token if you leave it unspun. Use spin tokens in Goals History."
                : "Complete more goals to unlock a spin token for today."}
            </div>
          )}
        </>
      )}
    </div>
  );

  return (
    <div className="stack">
      {allGoalsCompleted && rewardCard}

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

      {!allGoalsCompleted && rewardCard}

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
