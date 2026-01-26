import { DateTime, Duration } from "luxon";
import type { FilterKind } from "../types";

export function nowLocal() {
  return DateTime.local();
}

export function periodBounds(kind: FilterKind, base = nowLocal()) {
  let start = base.startOf("day");
  if (kind === "week") {
    start = base.minus({ days: base.weekday - 1 }).startOf("day"); // Monday = 1
  } else if (kind === "month") {
    start = base.startOf("month");
  }
  const end =
    kind === "today"
      ? start.plus({ days: 1 })
      : kind === "week"
        ? start.plus({ days: 7 })
        : start.plus({ months: 1 });
  return { start, end };
}

export function widenedUtcFetchBounds(kind: FilterKind, padHours = 14) {
  const { start, end } = periodBounds(kind);
  const pad = Duration.fromObject({ hours: padHours });
  return {
    startUtcISO: start.minus(pad).toUTC().toISO(),
    endUtcISO: end.plus(pad).toUTC().toISO(),
  };
}

export function isInPeriodByRowOffset(
  occurredAtISO: string,
  tzOffsetMinutes: number,
  kind: FilterKind,
  base = nowLocal(),
) {
  const { start, end } = periodBounds(kind, base);
  const localTs = DateTime.fromISO(occurredAtISO, { zone: "utc" }).plus({
    minutes: tzOffsetMinutes,
  });
  return localTs >= start && localTs < end;
}

export function toDisplayDateTime(occurredAtISO: string, tzOffsetMinutes: number) {
  // Render based on stored local offset
  const localTs = DateTime.fromISO(occurredAtISO, { zone: "utc" }).plus({
    minutes: tzOffsetMinutes,
  });
  return localTs.toLocaleString({ weekday: "short", hour: "numeric", minute: "2-digit" });
}

export function tzOffsetNowMinutes() {
  // JS returns minutes behind UTC as positive for locales West of UTC
  return -new Date().getTimezoneOffset();
}
