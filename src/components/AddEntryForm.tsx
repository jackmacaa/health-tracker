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

  // Update meal type when datetime changes
  useEffect(() => {
    setMeal(getMealTypeFromDateTime(dt));
  }, [dt]);

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
    console.log("Submitting:", { local: localDt.toString(), utc: occurredAtUtc, tzOffset });
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
        <textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="e.g., Greek yogurt, banana"
        />
      </div>
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="btn blue"
          type="button"
          onClick={() => {
            setDt(DateTime.local().toFormat("yyyy-MM-dd'T'HH:mm"));
          }}
        >
          Now
        </button>
        <button
          className="btn danger"
          type="button"
          onClick={() => {
            setDescription("");
            setDt(DateTime.local().toFormat("yyyy-MM-dd'T'HH:mm"));
          }}
        >
          Reset
        </button>
      </div>
      <div className="stack">
        <label>Meal type</label>
        <MealTypeChips value={meal} onChange={setMeal} />
      </div>
      <div className="stack">
        <label>Date & time</label>
        <input type="datetime-local" value={dt ?? ""} onChange={(e) => setDt(e.target.value)} />
      </div>
      {err && (
        <div className="item-sub" style={{ color: "#ffb4b4" }}>
          {err}
        </div>
      )}
    </form>
  );
}
