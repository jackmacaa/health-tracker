import { useState, useEffect } from "react";
import type { MealType } from "../types";

interface Props {
  mealType: MealType | null;
  onSelect: (emoji: string) => void;
}

const MEAL_EMOJIS: Record<MealType, string[]> = {
  breakfast: [
    "🥐", "🥞", "🧇", "🥓", "🍳", "🥚", "🍞", "🥯",
    "🥖", "🧈", "🥛", "☕", "🫖", "🥤", "🧃", "🍊",
    "🍌", "🍎", "🍓", "🫐", "🥣", "🥗", "🧀", "🥜"
  ],
  lunch: [
    "🥪", "🌮", "🌯", "🥙", "🍕", "🍔", "🍟", "🌭",
    "🥗", "🥘", "🍝", "🍜", "🍲", "🥫", "🍱", "🍛",
    "🍣", "🥟", "🦪", "🍤", "🥡", "🥬", "🥒", "🍅"
  ],
  dinner: [
    "🍖", "🍗", "🥩", "🍤", "🦞", "🦐", "🍣", "🍱",
    "🍝", "🍜", "🍲", "🥘", "🍛", "🍕", "🥗", "🍔",
    "🌮", "🥙", "🦴", "🥟", "🥡", "🍚", "🍢", "🧆"
  ],
  snack: [
    "🍪", "🍩", "🧁", "🍰", "🎂", "🍫", "🍬", "🍭",
    "🍮", "🍯", "🍿", "🥨", "🍘", "🍙", "🍚", "🥠",
    "🧊", "🍦", "🍧", "🍨", "🥜", "🌰", "🥔", "🍇"
  ]
};

const STORAGE_KEY = "health-tracker-favorite-emojis";

function getFavorites(): string[] {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

function saveFavorites(favorites: string[]): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(favorites));
  } catch (e) {
    console.error("Failed to save favorites:", e);
  }
}

export default function EmojiPicker({ mealType, onSelect }: Props) {
  const [favorites, setFavorites] = useState<string[]>([]);

  useEffect(() => {
    setFavorites(getFavorites());
  }, []);

  if (!mealType) return null;

  const emojis = MEAL_EMOJIS[mealType];

  const toggleFavorite = (emoji: string) => {
    const newFavorites = favorites.includes(emoji)
      ? favorites.filter((e) => e !== emoji)
      : [...favorites, emoji];
    setFavorites(newFavorites);
    saveFavorites(newFavorites);
  };

  const handleEmojiClick = (emoji: string) => {
    onSelect(emoji);
  };

  return (
    <div className="stack" style={{ gap: "0.5rem" }}>
      {favorites.length > 0 && (
        <div className="stack" style={{ gap: "0.25rem" }}>
          <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>Favorites</div>
          <div className="emoji-row">
            {favorites.map((emoji) => (
              <button
                key={emoji}
                type="button"
                className="emoji-btn favorite"
                onClick={() => handleEmojiClick(emoji)}
                title="Click to use"
              >
                {emoji}
              </button>
            ))}
          </div>
        </div>
      )}
      
      <div className="stack" style={{ gap: "0.25rem" }}>
        <div style={{ fontSize: "0.75rem", opacity: 0.7 }}>
          {mealType.charAt(0).toUpperCase() + mealType.slice(1)} options (swipe to see more)
        </div>
        <div className="emoji-row">
          {emojis.map((emoji) => (
            <button
              key={emoji}
              type="button"
              className={`emoji-btn ${favorites.includes(emoji) ? "is-favorite" : ""}`}
              onClick={() => handleEmojiClick(emoji)}
              onDoubleClick={() => toggleFavorite(emoji)}
              title={favorites.includes(emoji) ? "Double-click to unfavorite" : "Double-click to favorite"}
            >
              {emoji}
              {favorites.includes(emoji) && (
                <span className="favorite-star">⭐</span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
