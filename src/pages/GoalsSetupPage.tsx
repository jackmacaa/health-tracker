import { useEffect, useMemo, useState } from "react";
import {
  createGoalTemplate,
  deleteGoalTemplate,
  listGoalTemplatesWithItems,
  replaceGoalTemplateItems,
  updateGoalTemplate,
} from "../api/goals";
import { getGoalRewardSettings, upsertGoalRewardSettings } from "../api/goalRewards";
import type { GoalTemplate, RewardThresholdMode } from "../types";

interface Props {
  userId: string;
}

export default function GoalsSetupPage({ userId }: Props) {
  const [templates, setTemplates] = useState<
    Array<GoalTemplate & { items: Array<{ id: string; label: string }> }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [title, setTitle] = useState("");
  const [goalKind, setGoalKind] = useState<"checkbox" | "number">("checkbox");
  const [targetValue, setTargetValue] = useState("5");
  const [itemLabels, setItemLabels] = useState("");

  const [rewardLabel, setRewardLabel] = useState("");
  const [chancePercent, setChancePercent] = useState("50");
  const [thresholdMode, setThresholdMode] = useState<RewardThresholdMode>("percent");
  const [thresholdValue, setThresholdValue] = useState("80");

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [templateRows, reward] = await Promise.all([
        listGoalTemplatesWithItems(userId),
        getGoalRewardSettings(userId),
      ]);
      setTemplates(templateRows);
      if (reward) {
        setRewardLabel(reward.reward_label);
        setChancePercent(String(reward.chance_percent));
        setThresholdMode(reward.threshold_mode);
        setThresholdValue(String(reward.threshold_value));
      }
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [userId]);

  const nextDisplayOrder = useMemo(() => {
    if (templates.length === 0) return 0;
    return Math.max(...templates.map((template) => template.display_order)) + 1;
  }, [templates]);

  async function submitGoal(e: React.FormEvent) {
    e.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle) {
      setError("Goal title is required.");
      return;
    }

    const parsedTarget = Number(targetValue);
    if (goalKind === "number" && (Number.isNaN(parsedTarget) || parsedTarget <= 0)) {
      setError("Number goal target must be greater than 0.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const created = await createGoalTemplate({
        user_id: userId,
        title: cleanTitle,
        goal_kind: goalKind,
        target_value: goalKind === "number" ? Math.floor(parsedTarget) : null,
        display_order: nextDisplayOrder,
      });

      if (goalKind === "checkbox") {
        const labels = itemLabels
          .split(/\r?\n|,/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        if (labels.length > 0) {
          await replaceGoalTemplateItems(created.id, labels);
        }
      }

      setTitle("");
      setGoalKind("checkbox");
      setTargetValue("5");
      setItemLabels("");
      setSuccess("Goal saved.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function toggleGoalActive(template: GoalTemplate) {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateGoalTemplate(template.id, { active: !template.active });
      setSuccess(template.active ? "Goal archived." : "Goal re-enabled.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function removeGoal(template: GoalTemplate) {
    const ok = confirm("Delete this goal template? This will remove past progress for that goal.");
    if (!ok) return;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await deleteGoalTemplate(template.id);
      setSuccess("Goal deleted.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function moveGoal(templateId: string, direction: "up" | "down") {
    const index = templates.findIndex((template) => template.id === templateId);
    if (index < 0) return;
    const swapIndex = direction === "up" ? index - 1 : index + 1;
    if (swapIndex < 0 || swapIndex >= templates.length) return;

    const current = templates[index];
    const neighbor = templates[swapIndex];

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await Promise.all([
        updateGoalTemplate(current.id, { display_order: neighbor.display_order }),
        updateGoalTemplate(neighbor.id, { display_order: current.display_order }),
      ]);
      setSuccess("Goal order updated.");
      await load();
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  async function saveRewardSettings(e: React.FormEvent) {
    e.preventDefault();
    const cleanLabel = rewardLabel.trim();
    const chance = Number(chancePercent);
    const threshold = Number(thresholdValue);

    if (!cleanLabel) {
      setError("Reward name is required.");
      return;
    }
    if (Number.isNaN(chance) || chance < 0 || chance > 100) {
      setError("Chance must be between 0 and 100.");
      return;
    }
    if (Number.isNaN(threshold) || threshold <= 0) {
      setError("Threshold must be greater than 0.");
      return;
    }
    if (thresholdMode === "percent" && threshold > 100) {
      setError("Percent threshold must be 100 or lower.");
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await upsertGoalRewardSettings({
        user_id: userId,
        reward_label: cleanLabel,
        chance_percent: Number(chance.toFixed(2)),
        threshold_mode: thresholdMode,
        threshold_value: Number(threshold.toFixed(2)),
      });
      setSuccess("Reward settings saved.");
    } catch (e: any) {
      setError(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="stack">
      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Daily Goal Templates</div>
        <div className="item-sub">These goals repeat every day until you edit or archive them.</div>
        <form className="stack" onSubmit={submitGoal}>
          <div className="stack" style={{ gap: "6px" }}>
            <label>Goal title</label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Back exercises"
            />
          </div>

          <div className="stack" style={{ gap: "6px" }}>
            <label>Goal type</label>
            <select
              value={goalKind}
              onChange={(e) => setGoalKind(e.target.value as "checkbox" | "number")}
            >
              <option value="checkbox">Checkbox</option>
              <option value="number">Number with threshold</option>
            </select>
          </div>

          {goalKind === "number" && (
            <div className="stack" style={{ gap: "6px" }}>
              <label>Target number for completion</label>
              <input
                type="number"
                min="1"
                step="1"
                value={targetValue}
                onChange={(e) => setTargetValue(e.target.value)}
                placeholder="5"
              />
            </div>
          )}

          {goalKind === "checkbox" && (
            <div className="stack" style={{ gap: "6px" }}>
              <label>Optional checklist items (one per line or comma-separated)</label>
              <textarea
                value={itemLabels}
                onChange={(e) => setItemLabels(e.target.value)}
                placeholder={"Breakfast\nLunch\nDinner"}
              />
            </div>
          )}

          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save goal"}
          </button>
        </form>
      </div>

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Reward Settings</div>
        <div className="item-sub">
          Unlock one spin per day as soon as your goal threshold is met.
        </div>
        <form className="stack" onSubmit={saveRewardSettings}>
          <div className="stack" style={{ gap: "6px" }}>
            <label>Reward name</label>
            <input
              value={rewardLabel}
              onChange={(e) => setRewardLabel(e.target.value)}
              placeholder="e.g. Buy a magic booster pack"
            />
          </div>

          <div className="stack" style={{ gap: "6px" }}>
            <label>Reward chance %</label>
            <input
              type="number"
              min="0"
              max="100"
              step="0.1"
              value={chancePercent}
              onChange={(e) => setChancePercent(e.target.value)}
            />
          </div>

          <div className="stack" style={{ gap: "6px" }}>
            <label>Eligibility mode</label>
            <select
              value={thresholdMode}
              onChange={(e) => setThresholdMode(e.target.value as RewardThresholdMode)}
            >
              <option value="count">Fixed count of completed goals</option>
              <option value="percent">Percent of completed goals</option>
            </select>
          </div>

          <div className="stack" style={{ gap: "6px" }}>
            <label>{thresholdMode === "count" ? "Goals required" : "Percent required"}</label>
            <input
              type="number"
              min="1"
              max={thresholdMode === "percent" ? "100" : undefined}
              step={thresholdMode === "percent" ? "0.1" : "1"}
              value={thresholdValue}
              onChange={(e) => setThresholdValue(e.target.value)}
            />
          </div>

          <button className="btn" type="submit" disabled={saving}>
            {saving ? "Saving..." : "Save reward settings"}
          </button>
        </form>
      </div>

      <div className="card stack">
        <div style={{ fontWeight: 700 }}>Configured Goals</div>
        {loading && <div className="item-sub">Loading goals...</div>}
        {!loading && templates.length === 0 && (
          <div className="item-sub">No goals yet. Create your first one above.</div>
        )}
        <div className="list">
          {templates.map((template, index) => (
            <div className="item" key={template.id}>
              <div className="item-body">
                <div className="item-title">
                  {template.title} {template.active ? "" : "(archived)"}
                </div>
                <div className="item-sub">
                  {template.goal_kind === "number"
                    ? `Number goal · target ${template.target_value}`
                    : template.items.length > 0
                      ? `Checklist goal · ${template.items.length} items`
                      : "Single checkbox goal"}
                </div>
                {template.items.length > 0 && (
                  <div className="item-sub">
                    {template.items.map((item) => item.label).join(" · ")}
                  </div>
                )}
              </div>
              <div className="row" style={{ gap: "8px" }}>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => moveGoal(template.id, "up")}
                  disabled={saving || index === 0}
                  title="Move up"
                >
                  ↑
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => moveGoal(template.id, "down")}
                  disabled={saving || index === templates.length - 1}
                  title="Move down"
                >
                  ↓
                </button>
                <button
                  className="btn secondary"
                  type="button"
                  onClick={() => toggleGoalActive(template)}
                  disabled={saving}
                >
                  {template.active ? "Archive" : "Activate"}
                </button>
                <button
                  className="btn danger"
                  type="button"
                  onClick={() => removeGoal(template)}
                  disabled={saving}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
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
