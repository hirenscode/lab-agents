# Phase 7 — Triggers

Each agent can use manual, once, interval, daily or weekday schedule, and file-appears triggers. Schedules use the selected IANA time zone. A daily time skipped by daylight saving is omitted for that day. If the clock repeats the time, the first occurrence is used.

The scheduler persists its cursor and commits each scheduled run with the trigger update in one transaction. It polls the immediate files in a selected folder every 15 seconds. The first poll records the baseline. Catch-up can run once or skip a late occurrence or a trigger whose brain is offline.

Run `npm test` for fake-clock, restart, brain availability, and polling coverage. Synology share behavior remains pending.
