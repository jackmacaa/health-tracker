import { useState, useEffect } from "react";
import { DateTime } from "luxon";
import type { MealType } from "../types";
import MealTypeChips from "./MealTypeChips";

interface Props {
  onCreate: (input: {
    description: string;
    meal_type: MealType;
    occurred_at: string;
    tz_offset_minutes: number;
  }) => Promise<void>;
}

function getDefaultMealType(): MealType {
  const hour = DateTime.local().hour;
  if (hour < 10) return "breakfast";
  if (hour < 16) return "lunch";
  return "dinner";
}

function getMealTypeFromDateTime(dtString: string): MealType {
  const parsed = DateTime.fromISO(dtString);
  if (!parsed.isValid) return getDefaultMealType();
  const hour = parsed.hour;
  if (hour < 10) return "breakfast";
  if (hour < 16) return "lunch";
  return "dinner";
}

function getDefaultTimeForMealType(
  mealType: MealType,
  baseDate?: DateTime,
): DateTime {
  const base = baseDate || DateTime.local();
  const timeMap: Record<MealType, number> = {
    breakfast: 8,
    lunch: 12,
    dinner: 18,
    snack: 15,
  };
  return base.set({
    hour: timeMap[mealType],
    minute: 0,
    second: 0,
    millisecond: 0,
  });
}

export default function AddEntryForm({ onCreate }: Props) {
  const [description, setDescription] = useState("");
  const [meal, setMeal] = useState<MealType | null>(null);
  const [dt, setDt] = useState(DateTime.local().toFormat("yyyy-MM-dd'T'HH:mm"));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    // Set default meal type on mount
    setMeal(getDefaultMealType());
  }, []);

  function handleMealChange(newMeal: MealType | null) {
    setMeal(newMeal);
    if (newMeal) {
      // Set the datetime to the default time for this meal type, keeping the current date
      const currentDate = DateTime.fromISO(dt);
      const defaultTime = getDefaultTimeForMealType(newMeal, currentDate);
      setDt(defaultTime.toFormat("yyyy-MM-dd'T'HH:mm"));
    }
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);
    if (!meal) {
      setErr("Choose meal type");
      return;
    }
    const clean = description.trim();
    if (!clean) {
      setErr("Enter what you ate");
      return;
    }
    const localDt = DateTime.fromISO(dt ?? "");
    if (!localDt.isValid) {
      setErr("Invalid date/time");
      return;
    }
    // Store as local ISO string (no UTC conversion) + current timezone offset
    const occurredAtUtc = localDt.toUTC().toISO({ suppressMilliseconds: true });
    const tzOffset = -new Date().getTimezoneOffset(); // minutes ahead of UTC
    console.log("Submitting:", {
      local: localDt.toString(),
      utc: occurredAtUtc,
      tzOffset,
    });
    setBusy(true);
    try {
      await onCreate({
        description: clean,
        meal_type: meal,
        occurred_at: occurredAtUtc!,
        tz_offset_minutes: tzOffset,
      });
      setDescription("");
      setMeal(meal);
      setDt(DateTime.local().toFormat("yyyy-MM-dd'T'HH:mm"));
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="card stack" onSubmit={submit}>
      <div className="stack">
        <label>What did you eat?</label>
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g., Greek yogurt, banana"
        />
      </div>
      <div className="stack">
        <label>Meal type</label>
        <MealTypeChips value={meal} onChange={handleMealChange} />
      </div>
      <div className="stack">
        <label>Date & time</label>
        <input
          type="datetime-local"
          value={dt ?? ""}
          onChange={(e) => setDt(e.target.value)}
        />
      </div>
      {err && (
        <div className="item-sub" style={{ color: "#ffb4b4" }}>
          {err}
        </div>
      )}
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            setDescription("");
            setDt(DateTime.local().toFormat("yyyy-MM-dd'T'HH:mm"));
          }}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
