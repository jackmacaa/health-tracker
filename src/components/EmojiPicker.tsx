import type { MealType } from "../types";
import { MEAL_EMOJIS } from "../constants";

interface Props {
  mealType: MealType | null;
  onSelect: (emoji: string) => void;
}

export default function EmojiPicker({ mealType, onSelect }: Props) {
  if (!mealType) return null;

  const emojis = MEAL_EMOJIS[mealType];

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      <div className="stack" style={{ gap: "0.25rem" }}>
        <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
          {mealType.charAt(0).toUpperCase() + mealType.slice(1)} options (swipe to see more)
        </div>
        <div className="emoji-row">
          {emojis.map((emoji) => (
            <button key={emoji} type="button" className="emoji-btn" onClick={() => onSelect(emoji)}>
              {emoji}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
