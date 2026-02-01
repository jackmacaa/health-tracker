import { DateTime, Duration, FixedOffsetZone } from "luxon";
import type { FilterKind } from "../types";

function asFixedZone(minutes: number) {
  return FixedOffsetZone.instance(minutes);
}

export function toLocalDateTime(
  occurredAtISO: string,
  tzOffsetMinutes: number,
) {
  return DateTime.fromISO(occurredAtISO, { zone: "utc" }).setZone(
    asFixedZone(tzOffsetMinutes),
  );
}

export function nowLocal() {
  return DateTime.local();
}

export function periodBounds(kind: FilterKind, base = nowLocal()) {
  let start: DateTime = base.startOf("day");
  if (kind === "week") {
    start = base.minus({ days: base.weekday - 1 }).startOf("day"); // Monday = 1
  } else if (kind === "month") {
    start = base.startOf("month");
  } else if (kind === "alltime") {
    // January 1, 1970 in local timezone
    start = DateTime.local(1970, 1, 1, 0, 0, 0);
  }
  const end =
    kind === "today"
      ? start.plus({ days: 1 })
      : kind === "week"
        ? start.plus({ days: 7 })
        : kind === "month"
          ? start.plus({ months: 1 })
          : DateTime.now().plus({ years: 100 }); // Far future for alltime
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
  const zoneAdjustedBase = base.setZone(asFixedZone(tzOffsetMinutes));
  const { start, end } = periodBounds(kind, zoneAdjustedBase as DateTime);
  const localTs = toLocalDateTime(occurredAtISO, tzOffsetMinutes);
  return localTs >= start && localTs < end;
}

export function toDisplayDateTime(
  occurredAtISO: string,
  tzOffsetMinutes: number,
) {
  const localTs = toLocalDateTime(occurredAtISO, tzOffsetMinutes);
  return localTs.toLocaleString({
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
}

export function toDisplayTime(occurredAtISO: string, tzOffsetMinutes: number) {
  const localTs = toLocalDateTime(occurredAtISO, tzOffsetMinutes);
  return localTs.toLocaleString({
    hour: "numeric",
    minute: "2-digit",
    hourCycle: "h12",
  });
}

export function tzOffsetNowMinutes() {
  // JS returns minutes behind UTC as positive for locales West of UTC
  return -new Date().getTimezoneOffset();
}
