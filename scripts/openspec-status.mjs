#!/usr/bin/env node
// Generates the OpenSpec change status table from tasks.md checkbox counts.
//
//   node scripts/openspec-status.mjs          # print table to stdout
//   node scripts/openspec-status.mjs --write  # rewrite the table in openspec/ROADMAP.md
//
// Status rules:
//   no tasks.md            -> "no tasks"
//   0 done                 -> "not started"
//   open > 0               -> "in progress"
//   0 open, >0 done        -> "complete — archive"

import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const CHANGES_DIR = "openspec/changes";
const ROADMAP = "openspec/ROADMAP.md";
const BEGIN = "<!-- status:begin -->";
const END = "<!-- status:end -->";

function countTasks(tasksPath) {
  const text = readFileSync(tasksPath, "utf8");
  const open = (text.match(/^- \[ \]/gm) ?? []).length;
  const done = (text.match(/^- \[x\]/gmi) ?? []).length;
  return { open, done };
}

function collect() {
  const rows = [];
  for (const entry of readdirSync(CHANGES_DIR, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const tasksPath = join(CHANGES_DIR, entry.name, "tasks.md");
    if (!existsSync(tasksPath)) {
      rows.push({ name: entry.name, open: 0, done: 0, total: 0, status: "no tasks" });
      continue;
    }
    const { open, done } = countTasks(tasksPath);
    const status =
      done === 0 && open === 0 ? "no tasks"
      : done === 0 ? "not started"
      : open > 0 ? "in progress"
      : "complete — archive";
    rows.push({ name: entry.name, open, done, total: open + done, status });
  }
  const order = { "in progress": 0, "not started": 1, "no tasks": 2, "complete — archive": 3 };
  rows.sort((a, b) => order[a.status] - order[b.status] || a.name.localeCompare(b.name));
  return rows;
}

function renderTable(rows) {
  const lines = [
    "|Change|Progress|Status|",
    "|---|---|---|",
    ...rows.map((r) => `|\`${r.name}\`|${r.done}/${r.total}|${r.status}|`),
  ];
  return lines.join("\n");
}

const rows = collect();
const table = renderTable(rows);

if (process.argv.includes("--write")) {
  const current = readFileSync(ROADMAP, "utf8");
  const begin = current.indexOf(BEGIN);
  const end = current.indexOf(END);
  if (begin === -1 || end === -1 || end < begin) {
    console.error(`Markers ${BEGIN} / ${END} not found in ${ROADMAP}`);
    process.exit(1);
  }
  const stamp = new Date().toISOString().slice(0, 10);
  const next =
    current.slice(0, begin + BEGIN.length) +
    `\n_Last refreshed: ${stamp} (\`node scripts/openspec-status.mjs --write\`)_\n\n` +
    table +
    "\n" +
    current.slice(end);
  writeFileSync(ROADMAP, next);
  console.log(`Updated ${ROADMAP} (${rows.length} changes).`);
} else {
  console.log(table);
}
