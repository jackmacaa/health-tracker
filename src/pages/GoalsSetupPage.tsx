import { useEffect, useMemo, useRef, useState } from "react";
import {
  createGoalTemplate,
  deleteGoalTemplate,
  listGoalTemplatesWithItems,
  replaceGoalTemplateItems,
  updateGoalTemplate,
} from "../api/goals";
import { getGoalRewardSettings, upsertGoalRewardSettings } from "../api/goalRewards";
import { playWheelSound, startWheelTickTrack } from "../lib/wheelFx";
import type { GoalTemplate, RewardThresholdMode } from "../types";

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

function pickLandingAngle(sectors: WheelSector[], didWin: boolean) {
  const matchingSectors = sectors.filter((sector) => sector.win === didWin);
  if (matchingSectors.length === 0) {
    return 0;
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

export default function GoalsSetupPage({ userId }: Props) {
  const [templates, setTemplates] = useState<
    Array<GoalTemplate & { items: Array<{ id: string; label: string; default_checked: boolean }> }>
  >([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const [editingTemplateId, setEditingTemplateId] = useState<string | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTargetValue, setEditTargetValue] = useState("1");
  const [editDefaultChecked, setEditDefaultChecked] = useState(false);
  const [editRequiredForReward, setEditRequiredForReward] = useState(false);

  const [title, setTitle] = useState("");
  const [goalKind, setGoalKind] = useState<"checkbox" | "number">("checkbox");
  const [targetValue, setTargetValue] = useState("5");
  const [itemLabels, setItemLabels] = useState("");
  const [defaultChecked, setDefaultChecked] = useState(false);
  const [requiredForReward, setRequiredForReward] = useState(false);

  const [rewardLabel, setRewardLabel] = useState("");
  const [chancePercent, setChancePercent] = useState("50");
  const [wheelSegmentCount, setWheelSegmentCount] = useState("12");
  const [thresholdMode, setThresholdMode] = useState<RewardThresholdMode>("percent");
  const [thresholdValue, setThresholdValue] = useState("80");
  const [secondChanceEnabled, setSecondChanceEnabled] = useState(true);
  const [secondChanceLabel, setSecondChanceLabel] = useState("Second chance spin");
  const [secondChanceChancePercent, setSecondChanceChancePercent] = useState("10");
  const [secondChanceThresholdMode, setSecondChanceThresholdMode] =
    useState<RewardThresholdMode>("percent");
  const [secondChanceThresholdValue, setSecondChanceThresholdValue] = useState("75");
  const [previewWheelRotation, setPreviewWheelRotation] = useState(0);
  const [previewWheelSpinning, setPreviewWheelSpinning] = useState(false);
  const [previewResult, setPreviewResult] = useState<string | null>(null);
  const [previewSoundOn, setPreviewSoundOn] = useState(true);
  const [previewWinBurstActive, setPreviewWinBurstActive] = useState(false);
  const previewTickStopRef = useRef<(() => void) | null>(null);
  const previewEndTimeoutRef = useRef<number | null>(null);
  const previewBurstTimeoutRef = useRef<number | null>(null);
  const [secondPreviewWheelRotation, setSecondPreviewWheelRotation] = useState(0);
  const [secondPreviewWheelSpinning, setSecondPreviewWheelSpinning] = useState(false);
  const [secondPreviewResult, setSecondPreviewResult] = useState<string | null>(null);
  const [secondPreviewWinBurstActive, setSecondPreviewWinBurstActive] = useState(false);
  const secondPreviewTickStopRef = useRef<(() => void) | null>(null);
  const secondPreviewEndTimeoutRef = useRef<number | null>(null);
  const secondPreviewBurstTimeoutRef = useRef<number | null>(null);

  const [showTemplatesSection, setShowTemplatesSection] = useState(true);
  const [showRewardSettingsSection, setShowRewardSettingsSection] = useState(true);
  const [showMainPreviewSection, setShowMainPreviewSection] = useState(true);
  const [showSecondPreviewSection, setShowSecondPreviewSection] = useState(true);
  const [showConfiguredSection, setShowConfiguredSection] = useState(true);

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
        setWheelSegmentCount(String(reward.wheel_segment_count ?? 12));
        setThresholdMode(reward.threshold_mode);
        setThresholdValue(String(reward.threshold_value));
        setSecondChanceEnabled(Boolean(reward.second_chance_enabled));
        setSecondChanceLabel(reward.second_chance_label ?? "Second chance spin");
        setSecondChanceChancePercent(String(reward.second_chance_chance_percent ?? 10));
        setSecondChanceThresholdMode(reward.second_chance_threshold_mode ?? "percent");
        setSecondChanceThresholdValue(String(reward.second_chance_threshold_value ?? 75));
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

  const previewChancePercent = useMemo(() => {
    const parsed = Number(chancePercent);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
  }, [chancePercent]);

  const previewSegmentCount = useMemo(() => {
    const parsed = Number(wheelSegmentCount);
    if (!Number.isFinite(parsed)) return 12;
    return Math.max(2, Math.min(72, Math.floor(parsed)));
  }, [wheelSegmentCount]);

  const previewWheelSectors = useMemo(
    () => buildWheelSectors(previewChancePercent, previewSegmentCount),
    [previewChancePercent, previewSegmentCount],
  );

  const previewWheelGradient = useMemo(
    () => buildWheelGradient(previewWheelSectors),
    [previewWheelSectors],
  );

  const secondPreviewChancePercent = useMemo(() => {
    const parsed = Number(secondChanceChancePercent);
    if (!Number.isFinite(parsed)) return 0;
    return Math.max(0, Math.min(100, parsed));
  }, [secondChanceChancePercent]);

  const secondPreviewWheelSectors = useMemo(
    () => buildWheelSectors(secondPreviewChancePercent, previewSegmentCount),
    [secondPreviewChancePercent, previewSegmentCount],
  );

  const secondPreviewWheelGradient = useMemo(
    () =>
      buildAlternatingWheelGradient(secondPreviewWheelSectors, {
        win: ["#2563eb", "#3b82f6"],
        lose: ["#f59e0b", "#fbbf24"],
      }),
    [secondPreviewWheelSectors],
  );

  useEffect(() => {
    return () => {
      previewTickStopRef.current?.();
      if (previewEndTimeoutRef.current != null) {
        window.clearTimeout(previewEndTimeoutRef.current);
      }
      if (previewBurstTimeoutRef.current != null) {
        window.clearTimeout(previewBurstTimeoutRef.current);
      }
      secondPreviewTickStopRef.current?.();
      if (secondPreviewEndTimeoutRef.current != null) {
        window.clearTimeout(secondPreviewEndTimeoutRef.current);
      }
      if (secondPreviewBurstTimeoutRef.current != null) {
        window.clearTimeout(secondPreviewBurstTimeoutRef.current);
      }
    };
  }, []);

  function spinPreviewWheel() {
    const rolledValue = Number((Math.random() * 100).toFixed(3));
    const didWin = rolledValue < previewChancePercent;
    const desiredPointerAngle = pickLandingAngle(previewWheelSectors, didWin);

    setPreviewResult(null);
    setPreviewWheelSpinning(true);
    playWheelSound("start", previewSoundOn);
    previewTickStopRef.current?.();
    previewTickStopRef.current = startWheelTickTrack(4000, previewSoundOn);
    setPreviewWheelRotation((prev) => {
      const currentNormalized = ((prev % 360) + 360) % 360;
      const finalNormalized = (360 - desiredPointerAngle) % 360;
      const deltaNormalized = (finalNormalized - currentNormalized + 360) % 360;
      const spinDegrees = 3600 + deltaNormalized;
      return prev + spinDegrees;
    });

    if (previewEndTimeoutRef.current != null) {
      window.clearTimeout(previewEndTimeoutRef.current);
    }
    previewEndTimeoutRef.current = window.setTimeout(() => {
      setPreviewWheelSpinning(false);
      previewTickStopRef.current?.();
      playWheelSound(didWin ? "win" : "miss", previewSoundOn);
      setPreviewResult(
        `Result: ${didWin ? "WIN" : "MISS"} (roll ${rolledValue.toFixed(3)} vs chance ${previewChancePercent.toFixed(1)}%)`,
      );
      if (didWin) {
        setPreviewWinBurstActive(true);
        if (previewBurstTimeoutRef.current != null) {
          window.clearTimeout(previewBurstTimeoutRef.current);
        }
        previewBurstTimeoutRef.current = window.setTimeout(
          () => setPreviewWinBurstActive(false),
          1100,
        );
      } else {
        setPreviewWinBurstActive(false);
      }
    }, 4200);
  }

  function spinSecondChancePreviewWheel() {
    const rolledValue = Number((Math.random() * 100).toFixed(3));
    const didWin = rolledValue < secondPreviewChancePercent;
    const desiredPointerAngle = pickLandingAngle(secondPreviewWheelSectors, didWin);

    setSecondPreviewResult(null);
    setSecondPreviewWheelSpinning(true);
    playWheelSound("start", previewSoundOn);
    secondPreviewTickStopRef.current?.();
    secondPreviewTickStopRef.current = startWheelTickTrack(3200, previewSoundOn);
    setSecondPreviewWheelRotation((prev) => {
      const currentNormalized = ((prev % 360) + 360) % 360;
      const finalNormalized = (360 - desiredPointerAngle) % 360;
      const deltaNormalized = (finalNormalized - currentNormalized + 360) % 360;
      const spinDegrees = 2880 + deltaNormalized;
      return prev + spinDegrees;
    });

    if (secondPreviewEndTimeoutRef.current != null) {
      window.clearTimeout(secondPreviewEndTimeoutRef.current);
    }
    secondPreviewEndTimeoutRef.current = window.setTimeout(() => {
      setSecondPreviewWheelSpinning(false);
      secondPreviewTickStopRef.current?.();
      playWheelSound(didWin ? "win" : "miss", previewSoundOn);
      setSecondPreviewResult(
        `Result: ${didWin ? "WIN" : "MISS"} (roll ${rolledValue.toFixed(3)} vs chance ${secondPreviewChancePercent.toFixed(1)}%)`,
      );
      if (didWin) {
        setSecondPreviewWinBurstActive(true);
        if (secondPreviewBurstTimeoutRef.current != null) {
          window.clearTimeout(secondPreviewBurstTimeoutRef.current);
        }
        secondPreviewBurstTimeoutRef.current = window.setTimeout(
          () => setSecondPreviewWinBurstActive(false),
          1100,
        );
      } else {
        setSecondPreviewWinBurstActive(false);
      }
    }, 3400);
  }

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
        default_checked: goalKind === "checkbox" ? defaultChecked : false,
        required_for_reward: requiredForReward,
        display_order: nextDisplayOrder,
      });

      if (goalKind === "checkbox") {
        const labels = itemLabels
          .split(/\r?\n|,/)
          .map((part) => part.trim())
          .filter((part) => part.length > 0);
        if (labels.length > 0) {
          await replaceGoalTemplateItems(
            created.id,
            labels.map((label) => ({ label, default_checked: defaultChecked })),
          );
        }
      }

      setTitle("");
      setGoalKind("checkbox");
      setTargetValue("5");
      setItemLabels("");
      setDefaultChecked(false);
      setRequiredForReward(false);
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
    const ok = confirm(
      `Are you sure you want to delete "${template.title}"? This will permanently remove this goal and its past progress.`,
    );
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

  function beginEdit(template: GoalTemplate) {
    setEditingTemplateId(template.id);
    setEditTitle(template.title);
    setEditTargetValue(String(template.target_value ?? 1));
    setEditDefaultChecked(Boolean(template.default_checked));
    setEditRequiredForReward(Boolean(template.required_for_reward));
    setError(null);
    setSuccess(null);
  }

  function cancelEdit() {
    setEditingTemplateId(null);
  }

  async function saveGoalEdits(template: GoalTemplate) {
    const cleanTitle = editTitle.trim();
    if (!cleanTitle) {
      setError("Goal title is required.");
      return;
    }

    const patch: Parameters<typeof updateGoalTemplate>[1] = {
      title: cleanTitle,
    };

    if (template.goal_kind === "number") {
      const parsedTarget = Number(editTargetValue);
      if (!Number.isInteger(parsedTarget) || parsedTarget <= 0) {
        setError("Number goal target must be a whole number greater than 0.");
        return;
      }
      patch.target_value = parsedTarget;
    }

    if (template.goal_kind === "checkbox") {
      patch.default_checked = editDefaultChecked;
    }
    patch.required_for_reward = editRequiredForReward;

    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      await updateGoalTemplate(template.id, patch);
      setSuccess("Goal updated.");
      setEditingTemplateId(null);
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
    const segments = Number(wheelSegmentCount);
    const threshold = Number(thresholdValue);
    const secondChanceChance = Number(secondChanceChancePercent);
    const secondChanceThreshold = Number(secondChanceThresholdValue);

    if (!cleanLabel) {
      setError("Reward name is required.");
      return;
    }
    if (Number.isNaN(chance) || chance < 0 || chance > 100) {
      setError("Chance must be between 0 and 100.");
      return;
    }
    if (!Number.isInteger(segments) || segments < 2 || segments > 72) {
      setError("Wheel segments must be a whole number between 2 and 72.");
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
    if (!secondChanceLabel.trim()) {
      setError("Second chance label is required.");
      return;
    }
    if (Number.isNaN(secondChanceChance) || secondChanceChance < 0 || secondChanceChance > 100) {
      setError("Second chance chance must be between 0 and 100.");
      return;
    }
    if (Number.isNaN(secondChanceThreshold) || secondChanceThreshold <= 0) {
      setError("Second chance threshold must be greater than 0.");
      return;
    }
    if (secondChanceThresholdMode === "percent" && secondChanceThreshold > 100) {
      setError("Second chance percent threshold must be 100 or lower.");
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
        wheel_segment_count: segments,
        threshold_mode: thresholdMode,
        threshold_value: Number(threshold.toFixed(2)),
        second_chance_enabled: secondChanceEnabled,
        second_chance_label: secondChanceLabel,
        second_chance_chance_percent: Number(secondChanceChance.toFixed(2)),
        second_chance_threshold_mode: secondChanceThresholdMode,
        second_chance_threshold_value: Number(secondChanceThreshold.toFixed(2)),
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
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Daily Goal Templates</div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowTemplatesSection((value) => !value)}
          >
            {showTemplatesSection ? "Hide" : "Show"}
          </button>
        </div>
        {showTemplatesSection && (
          <>
            <div className="item-sub">
              These goals repeat every day until you edit or archive them.
            </div>
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
                  <label className="row" style={{ gap: "8px", alignItems: "center" }}>
                    <input
                      type="checkbox"
                      checked={defaultChecked}
                      onChange={(e) => setDefaultChecked(e.target.checked)}
                    />
                    Start each day checked by default
                  </label>
                  <div className="item-sub">
                    Works for single-checkbox goals and checklist items when no progress exists yet.
                  </div>
                  <label>Optional checklist items (one per line or comma-separated)</label>
                  <textarea
                    value={itemLabels}
                    onChange={(e) => setItemLabels(e.target.value)}
                    placeholder={"Breakfast\nLunch\nDinner"}
                  />
                </div>
              )}

              <label className="row" style={{ gap: "8px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={requiredForReward}
                  onChange={(e) => setRequiredForReward(e.target.checked)}
                />
                Required for reward eligibility
              </label>
              <div className="item-sub">
                Required goals must be completed for both the main reward spin and second chance.
              </div>

              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save goal"}
              </button>
            </form>
          </>
        )}
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Reward Settings</div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowRewardSettingsSection((value) => !value)}
          >
            {showRewardSettingsSection ? "Hide" : "Show"}
          </button>
        </div>
        {showRewardSettingsSection && (
          <>
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
                <label>Wheel visual segments</label>
                <input
                  type="number"
                  min="2"
                  max="72"
                  step="1"
                  value={wheelSegmentCount}
                  onChange={(e) => setWheelSegmentCount(e.target.value)}
                />
                <div className="item-sub">Higher values look more like a carnival-style wheel.</div>
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

              <div className="divider" />

              <label className="row" style={{ gap: "8px", alignItems: "center" }}>
                <input
                  type="checkbox"
                  checked={secondChanceEnabled}
                  onChange={(e) => setSecondChanceEnabled(e.target.checked)}
                />
                Enable second chance
              </label>

              <div className="stack" style={{ gap: "6px" }}>
                <label>Second chance label</label>
                <input
                  value={secondChanceLabel}
                  onChange={(e) => setSecondChanceLabel(e.target.value)}
                  placeholder="e.g. Finish strong spin"
                  disabled={!secondChanceEnabled}
                />
              </div>

              <div className="stack" style={{ gap: "6px" }}>
                <label>Second chance win %</label>
                <input
                  type="number"
                  min="0"
                  max="100"
                  step="0.1"
                  value={secondChanceChancePercent}
                  onChange={(e) => setSecondChanceChancePercent(e.target.value)}
                  disabled={!secondChanceEnabled}
                />
                <div className="item-sub">
                  If you choose to bank instead of spin, this credits{" "}
                  {(Number(secondChanceChancePercent || 0) / 100).toFixed(2)} token(s).
                </div>
              </div>

              <div className="stack" style={{ gap: "6px" }}>
                <label>Second chance eligibility mode</label>
                <select
                  value={secondChanceThresholdMode}
                  onChange={(e) =>
                    setSecondChanceThresholdMode(e.target.value as RewardThresholdMode)
                  }
                  disabled={!secondChanceEnabled}
                >
                  <option value="count">Fixed count of completed goals</option>
                  <option value="percent">Percent of completed goals</option>
                </select>
              </div>

              <div className="stack" style={{ gap: "6px" }}>
                <label>
                  {secondChanceThresholdMode === "count"
                    ? "Second chance goals required"
                    : "Second chance percent required"}
                </label>
                <input
                  type="number"
                  min="1"
                  max={secondChanceThresholdMode === "percent" ? "100" : undefined}
                  step={secondChanceThresholdMode === "percent" ? "0.1" : "1"}
                  value={secondChanceThresholdValue}
                  onChange={(e) => setSecondChanceThresholdValue(e.target.value)}
                  disabled={!secondChanceEnabled}
                />
              </div>

              <button className="btn" type="submit" disabled={saving}>
                {saving ? "Saving..." : "Save reward settings"}
              </button>
            </form>
          </>
        )}
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Wheel Preview</div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowMainPreviewSection((value) => !value)}
          >
            {showMainPreviewSection ? "Hide" : "Show"}
          </button>
        </div>
        {showMainPreviewSection && (
          <>
            <div className="item-sub">
              Test the wheel with your current values above. This does not save or consume a real
              spin.
            </div>
            <div className={`goal-wheel-wrap ${previewWinBurstActive ? "is-win-burst" : ""}`}>
              <div className={`goal-wheel-pointer ${previewWheelSpinning ? "is-ticking" : ""}`} />
              <div
                className={`goal-wheel ${previewWheelSpinning ? "is-spinning" : ""}`}
                style={{
                  transform: `rotate(${previewWheelRotation}deg)`,
                  background: previewWheelGradient,
                }}
              >
                <button
                  className="goal-wheel-center"
                  type="button"
                  disabled={previewWheelSpinning}
                  onClick={spinPreviewWheel}
                >
                  {previewWheelSpinning ? "..." : "SPIN"}
                </button>
              </div>
              {previewWinBurstActive && (
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
                Win zone: {previewChancePercent.toFixed(1)}%
              </span>
              <span className="goal-wheel-legend-miss">
                Miss zone: {(100 - previewChancePercent).toFixed(1)}%
              </span>
              <span className="goal-wheel-legend-miss">Segments: {previewSegmentCount}</span>
              <button
                className="btn secondary"
                type="button"
                onClick={() => setPreviewSoundOn((value) => !value)}
              >
                Sound: {previewSoundOn ? "On" : "Off"}
              </button>
            </div>
            {previewResult && <div className="goal-attempt-box">{previewResult}</div>}
          </>
        )}
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Second Chance Wheel Preview</div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowSecondPreviewSection((value) => !value)}
          >
            {showSecondPreviewSection ? "Hide" : "Show"}
          </button>
        </div>
        {showSecondPreviewSection && (
          <>
            <div className="item-sub">
              Preview the second chance spinner separately. It uses the second chance chance
              percent.
            </div>
            <div
              className={`goal-wheel-wrap goal-wheel-wrap-bonus ${secondPreviewWinBurstActive ? "is-win-burst" : ""}`}
            >
              <div
                className={`goal-wheel-pointer goal-wheel-pointer-bonus ${secondPreviewWheelSpinning ? "is-ticking" : ""}`}
              />
              <div
                className={`goal-wheel goal-wheel-bonus ${secondPreviewWheelSpinning ? "is-spinning" : ""}`}
                style={{
                  transform: `rotate(${secondPreviewWheelRotation}deg)`,
                  background: secondPreviewWheelGradient,
                }}
              >
                <button
                  className="goal-wheel-center goal-wheel-center-bonus"
                  type="button"
                  disabled={secondPreviewWheelSpinning || !secondChanceEnabled}
                  onClick={spinSecondChancePreviewWheel}
                >
                  {secondPreviewWheelSpinning ? "..." : "TRY"}
                </button>
              </div>
              {secondPreviewWinBurstActive && (
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
                Win zone: {secondPreviewChancePercent.toFixed(1)}%
              </span>
              <span className="goal-wheel-legend-miss">
                Miss zone: {(100 - secondPreviewChancePercent).toFixed(1)}%
              </span>
              <span className="goal-wheel-legend-miss">Segments: {previewSegmentCount}</span>
              <span className="goal-wheel-legend-miss">
                Bank value: {(secondPreviewChancePercent / 100).toFixed(2)} token
              </span>
            </div>
            {!secondChanceEnabled && (
              <div className="goal-attempt-box">
                Enable second chance in Reward Settings to test this preview.
              </div>
            )}
            {secondPreviewResult && <div className="goal-attempt-box">{secondPreviewResult}</div>}
          </>
        )}
      </div>

      <div className="card stack">
        <div className="row" style={{ justifyContent: "space-between", alignItems: "center" }}>
          <div style={{ fontWeight: 700 }}>Configured Goals</div>
          <button
            className="btn secondary"
            type="button"
            onClick={() => setShowConfiguredSection((value) => !value)}
          >
            {showConfiguredSection ? "Hide" : "Show"}
          </button>
        </div>
        {showConfiguredSection && (
          <>
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
                    {template.goal_kind === "checkbox" && (
                      <div className="item-sub">
                        Default state: {template.default_checked ? "Checked" : "Unchecked"}
                      </div>
                    )}
                    <div className="item-sub">
                      Reward requirement: {template.required_for_reward ? "Required" : "Optional"}
                    </div>
                    {template.items.length > 0 && (
                      <div className="item-sub">
                        {template.items
                          .map((item) =>
                            item.default_checked ? `${item.label} (default checked)` : item.label,
                          )
                          .join(" · ")}
                      </div>
                    )}

                    {editingTemplateId === template.id && (
                      <div className="stack" style={{ marginTop: "10px", gap: "8px" }}>
                        <div className="stack" style={{ gap: "6px" }}>
                          <label>Edit title</label>
                          <input value={editTitle} onChange={(e) => setEditTitle(e.target.value)} />
                        </div>

                        {template.goal_kind === "number" && (
                          <div className="stack" style={{ gap: "6px" }}>
                            <label>Edit target number</label>
                            <input
                              type="number"
                              min="1"
                              step="1"
                              value={editTargetValue}
                              onChange={(e) => setEditTargetValue(e.target.value)}
                            />
                          </div>
                        )}

                        {template.goal_kind === "checkbox" && (
                          <label className="row" style={{ gap: "8px", alignItems: "center" }}>
                            <input
                              type="checkbox"
                              checked={editDefaultChecked}
                              onChange={(e) => setEditDefaultChecked(e.target.checked)}
                            />
                            Start each day checked by default
                          </label>
                        )}

                        <label className="row" style={{ gap: "8px", alignItems: "center" }}>
                          <input
                            type="checkbox"
                            checked={editRequiredForReward}
                            onChange={(e) => setEditRequiredForReward(e.target.checked)}
                          />
                          Required for reward eligibility
                        </label>

                        <div className="row" style={{ gap: "8px" }}>
                          <button
                            className="btn secondary"
                            type="button"
                            disabled={saving}
                            onClick={() => saveGoalEdits(template)}
                          >
                            Save changes
                          </button>
                          <button
                            className="btn secondary"
                            type="button"
                            disabled={saving}
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="row" style={{ gap: "8px" }}>
                    <button
                      className="btn secondary"
                      type="button"
                      onClick={() => beginEdit(template)}
                      disabled={saving}
                      title="Edit goal"
                      aria-label="Edit goal"
                    >
                      ✏️
                    </button>
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
                      title={template.active ? "Archive goal" : "Activate goal"}
                      aria-label={template.active ? "Archive goal" : "Activate goal"}
                    >
                      {template.active ? "🙈" : "👁️"}
                    </button>
                    <button
                      className="btn danger"
                      type="button"
                      onClick={() => removeGoal(template)}
                      disabled={saving}
                      title="Delete goal"
                      aria-label="Delete goal"
                    >
                      🗑️
                    </button>
                  </div>
                </div>
              ))}
            </div>
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
