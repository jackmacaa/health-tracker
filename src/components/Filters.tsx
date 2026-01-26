import type { FilterKind, MealType } from "../types";

interface Props {
  period: FilterKind;
  onPeriodChange: (k: FilterKind) => void;
  mealFilter: MealType | null;
  onMealFilterChange: (m: MealType | null) => void;
}

export default function Filters({ period, onPeriodChange, mealFilter, onMealFilterChange }: Props) {
  return (
    <div className="card stack">
      <div className="toolbar">
        {(["today", "week", "month"] as FilterKind[]).map((k) => (
          <button
            key={k}
            className={`chip ${period === k ? "active" : ""}`}
            onClick={() => onPeriodChange(k)}
          >
            {k === "today" ? "Today" : k === "week" ? "This Week" : "This Month"}
          </button>
        ))}
      </div>
      <div className="toolbar">
        <span className="item-sub">Filter meal:</span>
        {(["breakfast", "lunch", "dinner", "snack"] as MealType[]).map((m) => (
          <button
            key={m}
            className={`chip ghost ${mealFilter === m ? "active" : ""}`}
            onClick={() => onMealFilterChange(mealFilter === m ? null : m)}
          >
            {m.charAt(0).toUpperCase() + m.slice(1)}
          </button>
        ))}
      </div>
    </div>
  );
}
