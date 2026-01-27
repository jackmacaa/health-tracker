import type { FilterKind, MealType } from "../types";

interface Props {
  period: FilterKind;
  onPeriodChange: (k: FilterKind) => void;
  mealFilter: MealType | null;
  onMealFilterChange: (m: MealType | null) => void;
}

export default function Filters({ period, onPeriodChange, mealFilter, onMealFilterChange }: Props) {
  return (
    <div className="card">
      <details style={{ cursor: "pointer" }}>
        <summary style={{ fontWeight: 600, padding: "4px 0", userSelect: "none" }}>
          🔍 Filters
        </summary>
        <div className="stack" style={{ marginTop: "12px", gap: "8px" }}>
          <div className="stack">
            <label>Time period</label>
            <select value={period} onChange={(e) => onPeriodChange(e.target.value as FilterKind)}>
              <option value="today">Today</option>
              <option value="week">This Week</option>
              <option value="month">This Month</option>
              <option value="alltime">All Time</option>
            </select>
          </div>
          <div className="stack">
            <label>Meal type</label>
            <select
              value={mealFilter ?? ""}
              onChange={(e) => onMealFilterChange((e.target.value as MealType) || null)}
            >
              <option value="">All meals</option>
              <option value="breakfast">Breakfast</option>
              <option value="lunch">Lunch</option>
              <option value="dinner">Dinner</option>
              <option value="snack">Snack</option>
            </select>
          </div>
        </div>
      </details>
    </div>
  );
}
