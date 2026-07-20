import { useEffect, useMemo, useState } from "react";
import { DateTime } from "luxon";
import {
  countUnredeemedGoalRewards,
  listGoalRewardAttemptsRange,
  redeemGoalRewardsQuantity,
} from "../api/goalRewards";
import {
  listGoalDailyItemProgressRange,
  listGoalDailyProgressRange,
  listGoalTemplatesWithItems,
} from "../api/goals";
import {
  isTemplateCompleted,
  keyByTemplateId,
  keyByTemplateItemId,
  summarizeDay,
  toLocalDateISO,
} from "./goalsUtils";

interface Props {
  userId: string;
}

export default function GoalsHistoryPage({ userId }: Props) {
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [redeemQuantity, setRedeemQuantity] = useState("1");
  const [availableRewards, setAvailableRewards] = useState(0);

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
  const startDate = toLocalDateISO(today.minus({ days: 6 }));

  async function load() {
    setLoading(true);
    setError(null);
    setSuccess(null);
    try {
      const [templateData, progressData, itemProgressData, rewardData, availableCount] =
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
        ]);
      setTemplates(templateData);
      setProgressRows(progressData);
      setItemProgressRows(itemProgressData);
      setAttemptRows(rewardData);
      setAvailableRewards(availableCount);
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  const dates = useMemo(() => {
    return [...Array(7)].map((_, index) => toLocalDateISO(today.minus({ days: index })));
  }, [today.toISODate()]);

  const rowsByDate = useMemo(() => {
    const progressByDate: Record<string, ReturnType<typeof keyByTemplateId>> = {};
    const itemByDate: Record<string, ReturnType<typeof keyByTemplateItemId>> = {};
    const attemptsByDate: Record<string, (typeof attemptRows)[number]> = {};

    dates.forEach((date) => {
      const dayProgress = progressRows.filter((row) => row.local_date === date);
      const dayItemProgress = itemProgressRows.filter((row) => row.local_date === date);
      progressByDate[date] = keyByTemplateId(dayProgress);
      itemByDate[date] = keyByTemplateItemId(dayItemProgress);
    });

    attemptRows.forEach((attempt) => {
      attemptsByDate[attempt.local_date] = attempt;
    });

    return { progressByDate, itemByDate, attemptsByDate };
  }, [dates, progressRows, itemProgressRows, attemptRows]);

  const activeTemplates = templates.filter((template) => template.active);

  const totalWins = attemptRows.filter((attempt) => attempt.did_win).length;
  const canRedeem = (() => {
    const parsed = Number(redeemQuantity);
    return Number.isInteger(parsed) && parsed > 0 && parsed <= availableRewards;
  })();

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
        <div style={{ fontWeight: 700 }}>Last 7 Days</div>
        <div className="item-sub">
          Green check means all active daily goals were completed that day.
        </div>
      </div>

      {loading && <div className="card">Loading history...</div>}

      {!loading &&
        dates.map((date) => {
          const dayProgress = rowsByDate.progressByDate[date] ?? {};
          const dayItemProgress = rowsByDate.itemByDate[date] ?? {};
          const summary = summarizeDay(activeTemplates, dayProgress, dayItemProgress);
          const attempt = rowsByDate.attemptsByDate[date] ?? null;
          const label = DateTime.fromISO(date).toFormat("ccc, LLL d");

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
