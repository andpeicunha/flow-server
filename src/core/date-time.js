import formats from "ajv-formats/dist/formats.js";

export function isRfc3339DateTime(value) {
  return typeof value === "string" && formats.fullFormats["date-time"].validate(value);
}

export function rfc3339TimeValue(value) {
  if (!isRfc3339DateTime(value)) return Number.NaN;
  const match = /^(\d{4})-(\d{2})-(\d{2})[t ](\d{2}):(\d{2}):(\d{2})(?:\.(\d+))?(z|([+-])(\d{2})(?::?(\d{2}))?)$/i.exec(value);
  if (!match) return Number.NaN;
  const [, year, month, day, hour, minute, second, fraction = "", , sign, offsetHour = "0", offsetMinute = "0"] = match;
  const date = new Date(0);
  date.setUTCFullYear(Number(year), Number(month) - 1, Number(day));
  date.setUTCHours(Number(hour), Number(minute), Math.min(Number(second), 59), Number(fraction.slice(0, 3).padEnd(3, "0")));
  const offset = (Number(offsetHour) * 60 + Number(offsetMinute)) * 60_000 * (sign === "-" ? -1 : 1);
  const leapSecond = Number(second) === 60 ? 1_000 : 0;
  return date.getTime() - offset + leapSecond;
}
