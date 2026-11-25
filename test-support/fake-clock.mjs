export function fakeClock(start = "2026-01-01T00:00:00.000Z") {
  let time = new Date(start).getTime();
  return {
    now: () => new Date(time),
    advance(milliseconds) {
      time += milliseconds;
    },
  };
}
