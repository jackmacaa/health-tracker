import { useState } from "react";
import { DateTime } from "luxon";
import { tzOffsetNowMinutes } from "../lib/date";
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

export default function AddEntryForm({ onCreate }: Props) {
  const [description, setDescription] = useState("");
  const [meal, setMeal] = useState<MealType | null>(null);
  const [dt, setDt] = useState(DateTime.local().toISO({ suppressMilliseconds: true }));
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

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
    const occurredAtUtc = localDt.toUTC().toISO({ suppressMilliseconds: true });
    const tzOffset = tzOffsetNowMinutes();
    setBusy(true);
    try {
      await onCreate({
        description: clean,
        meal_type: meal,
        occurred_at: occurredAtUtc!,
        tz_offset_minutes: tzOffset,
      });
      setDescription("");
      setMeal(meal); // keep last selection sticky
      setDt(DateTime.local().toISO({ suppressMilliseconds: true }));
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
      <div className="row">
        <button className="btn" type="submit" disabled={busy}>
          {busy ? "Saving…" : "Save"}
        </button>
        <button
          className="btn secondary"
          type="button"
          onClick={() => {
            setDescription("");
            setDt(DateTime.local().toISO({ suppressMilliseconds: true }));
          }}
        >
          Reset
        </button>
      </div>
    </form>
  );
}
