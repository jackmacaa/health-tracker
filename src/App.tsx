import { useEffect, useMemo, useState } from "react";
import { NavLink, Navigate, Route, Routes, useLocation } from "react-router-dom";
import AuthGate from "./components/AuthGate";
import AddEntryForm from "./components/AddEntryForm";
import Filters from "./components/Filters";
import EntryList from "./components/EntryList";
import WeightTrackerPage from "./pages/WeightTrackerPage";
import LeaderboardPage from "./pages/LeaderboardPage";
import type { Entry, FilterKind, MealType } from "./types";
import { isInPeriodByRowOffset, toLocalDateTime, widenedUtcFetchBounds } from "./lib/date";
import { createEntry, listEntriesInRange } from "./api/entries";
import { supabase } from "./lib/supabase";

export default function App() {
  return <AuthGate>{(userId) => <AuthedApp userId={userId} />}</AuthGate>;
}

function AuthedApp({ userId }: { userId: string }) {
  const location = useLocation();
  const [signingOut, setSigningOut] = useState(false);

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    try {
      const { error } = await supabase.auth.signOut();
      if (error) {
        console.error("Sign out error:", error);
      }
    } catch (error) {
      console.error("Sign out error:", error);
    }
    // Clear all local storage and session storage
    localStorage.clear();
    sessionStorage.clear();
    // Force hard reload to clear all state
    window.location.href = window.location.origin;
  }

  return (
    <div>
      <header className="header">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1
            className="title"
            style={{
              fontWeight: 800,
              letterSpacing: "2px",
              fontSize: "24px",
              textShadow: "0 0 20px rgba(22, 163, 74, 0.5), 0 2px 4px rgba(0,0,0,0.1)",
            }}
          >
            🌍B2S
          </h1>
          <div className="row" style={{ gap: "8px" }}>
            <NavLink className={({ isActive }) => `tab${isActive ? " active" : ""}`} to="/" end>
              🍽️
            </NavLink>
            <NavLink className={({ isActive }) => `tab${isActive ? " active" : ""}`} to="/weight">
              📝
            </NavLink>
            <NavLink
              className={({ isActive }) => `tab${isActive ? " active" : ""}`}
              to="/leaderboard"
            >
              🏆
            </NavLink>
            <button className="chip ghost" onClick={signOut} disabled={signingOut}>
              {signingOut ? "Signing out..." : "Sign out"}
            </button>
          </div>
        </div>
      </header>
      <main className="container stack">
        <Routes>
          <Route path="/" element={<FoodTrackerPage />} />
          <Route path="/weight" element={<WeightTrackerPage userId={userId} />} />
          <Route path="/leaderboard" element={<LeaderboardPage userId={userId} />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
      {location.pathname === "/" && (
        <button className="fab" onClick={() => document.querySelector("textarea")?.focus()}>
          + Add
        </button>
      )}
    </div>
  );
}

function FoodTrackerPage() {
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

  const visible = useMemo(() => {
    const filtered = entries.filter((e) =>
      isInPeriodByRowOffset(e.occurred_at, e.tz_offset_minutes, period),
    );
    return filtered.sort((a, b) => {
      const aLocal = toLocalDateTime(a.occurred_at, a.tz_offset_minutes);
      const bLocal = toLocalDateTime(b.occurred_at, b.tz_offset_minutes);
      const timeA = aLocal.hour * 60 + aLocal.minute;
      const timeB = bLocal.hour * 60 + bLocal.minute;
      return timeA - timeB;
    });
  }, [entries, period]);

  async function handleCreate(input: {
    description: string;
    meal_type: MealType;
    occurred_at: string;
    tz_offset_minutes: number;
  }) {
    await createEntry(input);
    await load();
  }

  return (
    <div>
      <AddEntryForm onCreate={handleCreate} />
      <Filters
        period={period}
        onPeriodChange={setPeriod}
        mealFilter={mealFilter}
        onMealFilterChange={setMealFilter}
      />
      {loading && <div className="card">⏳ Loading…</div>}
      {err && (
        <div className="card" style={{ color: "#ffb4b4" }}>
          {err}
        </div>
      )}
      <EntryList entries={visible} mealFilter={mealFilter} period={period} onChanged={load} />
    </div>
  );
}
