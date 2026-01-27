import { useState } from "react";
import type { Challenge } from "../types";
import { joinChallenge } from "../api/challenges";
import { DateTime } from "luxon";

interface Props {
  userId: string;
  challenge: Challenge;
  onJoined: () => void;
}

export default function JoinChallengeForm({
  userId,
  challenge,
  onJoined,
}: Props) {
  const [displayName, setDisplayName] = useState("");
  const [weight, setWeight] = useState("");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function handleJoin(e: React.FormEvent) {
    e.preventDefault();
    setErr(null);

    const name = displayName.trim();
    if (name.length < 3) {
      setErr("Display name must be at least 3 characters");
      return;
    }

    const weightNum = Number(weight);
    if (!weight || Number.isNaN(weightNum) || weightNum <= 0) {
      setErr("Enter your starting weight in kg (e.g., 89.5)");
      return;
    }

    setSaving(true);
    try {
      await joinChallenge({
        challenge_id: challenge.id,
        user_id: userId,
        start_weight_kg: Number(weightNum.toFixed(1)),
        display_name: name,
      });
      onJoined();
    } catch (e: any) {
      setErr(e.message ?? String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card stack">
      <div style={{ fontWeight: 600 }}>Join Challenge</div>
      <div className="item-sub">
        {challenge.name} ·{" "}
        {DateTime.fromISO(challenge.start_at).toFormat("MMM d")} –{" "}
        {DateTime.fromISO(challenge.end_at).toFormat("MMM d")}
      </div>
      <form className="stack" onSubmit={handleJoin}>
        <div className="stack">
          <label>Display name (for leaderboard)</label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder="Your name or handle"
            minLength={3}
            maxLength={40}
            required
          />
          <div className="item-sub">
            3–40 characters. Kept private until you join.
          </div>
        </div>
        <div className="stack">
          <label>Starting weight (kg)</label>
          <input
            type="number"
            step="0.1"
            min="0"
            value={weight}
            onChange={(e) => setWeight(e.target.value)}
            placeholder="89.5"
            required
          />
        </div>
        {err && (
          <div className="item-sub" style={{ color: "#ff6b6b" }}>
            {err}
          </div>
        )}
        <button className="btn" type="submit" disabled={saving}>
          {saving ? "Joining…" : "Join Challenge"}
        </button>
      </form>
    </div>
  );
}
