#!/usr/bin/env node

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--now') args.now = argv[++i];
  }
  return args;
}

function previousBusinessDay(base) {
  const d = new Date(base.getFullYear(), base.getMonth(), base.getDate());
  d.setDate(d.getDate() - 1);
  while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() - 1);
  return d;
}

function pad(n, width = 2) {
  return String(n).padStart(width, '0');
}

function toLocalIso(date) {
  const offsetMin = -date.getTimezoneOffset();
  const sign = offsetMin >= 0 ? '+' : '-';
  const abs = Math.abs(offsetMin);
  const offset = `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`;
  const ymd = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  const hms = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${pad(date.getMilliseconds(), 3)}`;
  return `${ymd}T${hms}${offset}`;
}

function main() {
  const { now } = parseArgs(process.argv);
  const base = now === undefined ? new Date() : new Date(now);
  if (Number.isNaN(base.getTime())) {
    console.error(`error: --now is not a valid date: ${now}`);
    process.exit(2);
  }
  const day = previousBusinessDay(base);
  const timeMin = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 0, 0, 0, 0);
  const timeMax = new Date(day.getFullYear(), day.getMonth(), day.getDate(), 23, 59, 59, 999);
  process.stdout.write(JSON.stringify({ timeMin: toLocalIso(timeMin), timeMax: toLocalIso(timeMax) }) + '\n');
}

main();
