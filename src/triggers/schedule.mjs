const dayMs = 86_400_000;

export function scheduleFormatter(timeZone) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
  });
}

function wallTime(format, instant) {
  const part = Object.fromEntries(format.formatToParts(new Date(instant)).map(({ type, value }) => [type, Number(value)]));
  return Date.UTC(part.year, part.month - 1, part.day, part.hour, part.minute);
}

export function nextSchedule(after, { time, timeZone, days }) {
  const format = scheduleFormatter(timeZone);
  const [hour, minute] = time.split(":").map(Number);
  const midnight = Math.floor(wallTime(format, after) / dayMs) * dayMs;
  for (let count = 0; count < 15; count++) {
    const date = midnight + dayMs * count;
    if (!days.includes(new Date(date).getUTCDay())) continue;
    const wall = date + (hour * 60 + minute) * 60_000;
    const offsets = new Set([wall - dayMs, wall, wall + dayMs].map((point) => wallTime(format, point) - point));
    // Skip nonexistent times and use the first occurrence when the clocks repeat an hour.
    const first = [...offsets].map((offset) => wall - offset)
      .filter((instant) => wallTime(format, instant) === wall).sort((a, b) => a - b)[0];
    if (first > after) return first;
  }
  throw new Error("Could not calculate the next scheduled occurrence");
}
