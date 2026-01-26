import { useState } from "react";
import type { Entry, MealType } from "../types";
import { DateTime } from "luxon";
import { toDisplayDateTime } from "../lib/date";
import { deleteEntry, updateEntry } from "../api/entries";

interface Props {
  entries: Entry[];
  mealFilter: MealType | null;
  onChanged: () => void;
}

export default function EntryList({ entries, mealFilter, onChanged }: Props) {
  const filtered = entries.filter((e) => !mealFilter || e.meal_type === mealFilter);
  if (filtered.length === 0) return <div className="empty">No entries yet</div>;
  return (
    <div className="list">
      {filtered.map((e) => (
        <EntryItem key={e.id} entry={e} onChanged={onChanged} />
      ))}
      <div className="footer-space" />
    </div>
  );
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

  const localDate = toDisplayDateTime(entry.occurred_at, entry.tz_offset_minutes);
  const sub = `${entry.meal_type.charAt(0).toUpperCase() + entry.meal_type.slice(1)} • ${localDate}`;

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
              Edit
            </button>
            <button className="btn danger" onClick={remove} disabled={busy}>
              Delete
            </button>
          </>
        )}
      </div>
    </div>
  );
}
