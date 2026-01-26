import { useEffect, useMemo, useState } from "react";
import AuthGate from "./components/AuthGate";
import AddEntryForm from "./components/AddEntryForm";
import Filters from "./components/Filters";
import EntryList from "./components/EntryList";
import type { Entry, FilterKind, MealType } from "./types";
import { isInPeriodByRowOffset, widenedUtcFetchBounds } from "./lib/date";
import { createEntry, listEntriesInRange } from "./api/entries";
import { supabase } from "./lib/supabase";

export default function App() {
  return <AuthGate>{() => <Home />}</AuthGate>;
}

function Home() {
  const [period, setPeriod] = useState<FilterKind>("today");
  const [mealFilter, setMealFilter] = useState<MealType | null>(null);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setErr(null);
    try {
      const { startUtcISO, endUtcISO } = widenedUtcFetchBounds(period);
      const rows = await listEntriesInRange(startUtcISO!, endUtcISO!);
      setEntries(rows);
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load();
  }, [period]);

  const visible = useMemo(
    () => entries.filter((e) => isInPeriodByRowOffset(e.occurred_at, e.tz_offset_minutes, period)),
    [entries, period],
  );

  async function handleCreate(input: {
    description: string;
    meal_type: MealType;
    occurred_at: string;
    tz_offset_minutes: number;
  }) {
    await createEntry(input);
    await load();
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.reload();
  }

  return (
    <div>
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 className="title">🥗 Health Tracker</h1>
          <button className="chip ghost" onClick={signOut}>
            Sign out
          </button>
        </div>
      </header>
      <main className="container stack">
        <AddEntryForm onCreate={handleCreate} />
        <Filters
          period={period}
          onPeriodChange={setPeriod}
          mealFilter={mealFilter}
          onMealFilterChange={setMealFilter}
        />
        {loading && <div className="card">Loading…</div>}
        {err && (
          <div className="card" style={{ color: "#ffb4b4" }}>
            {err}
          </div>
        )}
        <EntryList entries={visible} mealFilter={mealFilter} onChanged={load} />
      </main>
      <button className="fab" onClick={() => document.querySelector("textarea")?.focus()}>
        + Add
      </button>
    </div>
  );
}
