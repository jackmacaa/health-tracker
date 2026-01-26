import type { MealType } from "../types";

const MEALS: { key: MealType; label: string }[] = [
  { key: "breakfast", label: "Breakfast" },
  { key: "lunch", label: "Lunch" },
  { key: "dinner", label: "Dinner" },
  { key: "snack", label: "Snack" },
];

interface Props {
  value: MealType | null;
  onChange: (v: MealType | null) => void;
}

export default function MealTypeChips({ value, onChange }: Props) {
  return (
    <div className="chips">
      {MEALS.map((m) => (
        <button
          type="button"
          key={m.key}
          className={`chip ${value === m.key ? "active" : ""}`}
          onClick={() => onChange(value === m.key ? null : m.key)}
        >
          {m.label}
        </button>
      ))}
    </div>
  );
}

export const MEAL_LABELS = Object.fromEntries(MEALS.map((m) => [m.key, m.label])) as Record<
  MealType,
  string
>;
