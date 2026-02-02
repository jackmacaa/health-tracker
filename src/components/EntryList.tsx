import { useState } from "react";
import type { Entry, MealType, FilterKind } from "../types";
import { DateTime } from "luxon";
import { toDisplayTime, toLocalDateTime } from "../lib/date";
import { deleteEntry, updateEntry } from "../api/entries";

interface Props {
  entries: Entry[];
  mealFilter: MealType | null;
  period: FilterKind;
  onChanged: () => void;
}

const MEAL_ORDER: Record<MealType, number> = {
  breakfast: 0,
  lunch: 1,
  dinner: 2,
  snack: 3,
};

const MEAL_LABELS: Record<MealType, string> = {
  breakfast: "Breakfast",
  lunch: "Lunch",
  dinner: "Dinner",
  snack: "Snack",
};

export default function EntryList({ entries, mealFilter, period, onChanged }: Props) {
  const filtered = entries.filter((e) => !mealFilter || e.meal_type === mealFilter);
  if (filtered.length === 0) return <div className="empty">No entries yet</div>;

  if (period === "today") {
    // Group by meal type only
    const grouped = new Map<MealType, Entry[]>();
    filtered.forEach((e) => {
      if (!grouped.has(e.meal_type)) {
        grouped.set(e.meal_type, []);
      }
      grouped.get(e.meal_type)!.push(e);
    });

    const sortedMeals = Array.from(grouped.entries()).sort(
      (a, b) => MEAL_ORDER[a[0]] - MEAL_ORDER[b[0]],
    );

    return (
      <div className="list">
        {sortedMeals.map(([mealType, entries]) => (
          <div key={mealType}>
            <div
              style={{
                padding: "1rem 0 0.5rem 0",
                fontWeight: "bold",
                color: "#666",
              }}
            >
              {MEAL_LABELS[mealType]}
            </div>
            {entries.map((e) => (
              <EntryItem key={e.id} entry={e} onChanged={onChanged} />
            ))}
          </div>
        ))}
        <div className="footer-space" />
      </div>
    );
  } else {
    // Group by date, then by meal type
    const groupedByDate = new Map<string, Map<MealType, Entry[]>>();

    filtered.forEach((e) => {
      const localDate = toLocalDateTime(e.occurred_at, e.tz_offset_minutes).toISODate();

      if (!groupedByDate.has(localDate!)) {
        groupedByDate.set(localDate!, new Map());
      }
      const dateGroup = groupedByDate.get(localDate!)!;
      if (!dateGroup.has(e.meal_type)) {
        dateGroup.set(e.meal_type, []);
      }
      dateGroup.get(e.meal_type)!.push(e);
    });

    // Sort dates in descending order (newest first)
    const sortedDates = Array.from(groupedByDate.keys()).sort().reverse();

    return (
      <div className="list">
        {sortedDates.map((date) => {
          const dateGroup = groupedByDate.get(date)!;
          const dateObj = DateTime.fromISO(date);
          const formattedDate = dateObj.toLocaleString({
            weekday: "long",
            month: "long",
            day: "numeric",
          });

          return (
            <div key={date}>
              <div
                style={{
                  padding: "1.5rem 0 0.5rem 0",
                  fontWeight: "bold",
                  fontSize: "1.1em",
                }}
              >
                {formattedDate}
              </div>
              {Array.from(dateGroup.entries())
                .sort((a, b) => MEAL_ORDER[a[0]] - MEAL_ORDER[b[0]])
                .map(([mealType, mealEntries]) => (
                  <div key={mealType}>
                    <div
                      style={{
                        padding: "0.75rem 0 0.5rem 0",
                        fontWeight: "bold",
                        color: "#666",
                        fontSize: "0.95em",
                      }}
                    >
                      {MEAL_LABELS[mealType]}
                    </div>
                    {mealEntries.map((e) => (
                      <EntryItem key={e.id} entry={e} onChanged={onChanged} />
                    ))}
                  </div>
                ))}
            </div>
          );
        })}
        <div className="footer-space" />
      </div>
    );
  }
}

function EntryItem({ entry, onChanged }: { entry: Entry; onChanged: () => void }) {
  const [editing, setEditing] = useState(false);
  const [desc, setDesc] = useState(entry.description);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function save() {
    setBusy(true);
    setErr(null);
    try {
      const clean = desc.trim();
      if (!clean) throw new Error("Description cannot be empty");
      await updateEntry(entry.id, { description: clean });
      setEditing(false);
      onChanged();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    const ok = confirm("Delete this entry?");
    if (!ok) return;
    setBusy(true);
    setErr(null);
    try {
      await deleteEntry(entry.id);
      onChanged();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setBusy(false);
    }
  }

  const localDate = toDisplayTime(entry.occurred_at, entry.tz_offset_minutes);
  const sub = localDate;

  return (
    <div className="item">
      <div className="item-body">
        {editing ? (
          <input value={desc} onChange={(e) => setDesc(e.target.value)} />
        ) : (
          <div className="item-title">{entry.description}</div>
        )}
        <div className="item-sub">{sub}</div>
        {err && (
          <div className="item-sub" style={{ color: "#ffb4b4" }}>
            {err}
          </div>
        )}
      </div>
      <div className="row">
        {editing ? (
          <>
            <button className="btn" onClick={save} disabled={busy}>
              {busy ? "Saving…" : "Save"}
            </button>
            <button
              className="btn secondary"
              onClick={() => {
                setEditing(false);
                setDesc(entry.description);
              }}
            >
              Cancel
            </button>
          </>
        ) : (
          <>
            <button className="btn secondary" onClick={() => setEditing(true)}>
              ✏️
            </button>
            <button className="btn danger" onClick={remove} disabled={busy}>
              🗑️
            </button>
          </>
        )}
      </div>
    </div>
  );
}
