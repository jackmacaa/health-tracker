let audioContext: AudioContext | null = null;

function getAudioContext() {
  if (typeof window === "undefined") return null;
  if (!audioContext) {
    const Ctor = window.AudioContext || (window as any).webkitAudioContext;
    if (!Ctor) return null;
    audioContext = new Ctor();
  }
  return audioContext;
}

function beep(params: { frequency: number; durationMs: number; gain: number; type?: OscillatorType }) {
  const ctx = getAudioContext();
  if (!ctx) return;

  if (ctx.state === "suspended") {
    void ctx.resume();
  }

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  const now = ctx.currentTime;
  const duration = params.durationMs / 1000;

  osc.type = params.type ?? "sine";
  osc.frequency.setValueAtTime(params.frequency, now);

  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, params.gain), now + 0.01);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);

  osc.connect(gain);
  gain.connect(ctx.destination);

  osc.start(now);
  osc.stop(now + duration + 0.02);
}

export function playWheelSound(kind: "start" | "tick" | "win" | "miss", enabled: boolean) {
  if (!enabled) return;

  if (kind === "start") {
    beep({ frequency: 210, durationMs: 80, gain: 0.08, type: "triangle" });
    return;
  }

  if (kind === "tick") {
    beep({ frequency: 1200, durationMs: 20, gain: 0.03, type: "square" });
    return;
  }

  if (kind === "win") {
    beep({ frequency: 660, durationMs: 90, gain: 0.08, type: "triangle" });
    window.setTimeout(() => beep({ frequency: 880, durationMs: 120, gain: 0.08, type: "triangle" }), 90);
    window.setTimeout(() => beep({ frequency: 1320, durationMs: 160, gain: 0.09, type: "triangle" }), 210);
    return;
  }

  beep({ frequency: 220, durationMs: 180, gain: 0.07, type: "sawtooth" });
}

export function startWheelTickTrack(durationMs: number, enabled: boolean) {
  if (!enabled) {
    return () => undefined;
  }

  let stopped = false;
  const startedAt = Date.now();
  let timeoutId: number | undefined;

  const loop = () => {
    if (stopped) return;
    const elapsed = Date.now() - startedAt;
    if (elapsed >= durationMs) return;

    playWheelSound("tick", true);

    const progress = Math.min(1, elapsed / durationMs);
    const interval = Math.round(55 + progress * 210);
    timeoutId = window.setTimeout(loop, interval);
  };

  loop();

  return () => {
    stopped = true;
    if (timeoutId != null) {
      window.clearTimeout(timeoutId);
    }
  };
}
