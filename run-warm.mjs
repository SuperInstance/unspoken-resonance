#!/usr/bin/env node
// run-warm.mjs — Bridge 2 A/B: cold-start vs warm-started resonance.
// Phase 1: run 4 cold campaigns, index every tuned field into FieldMemory.
// Phase 2: run 3 NEW seeds cold AND warm (same chorus seeds), receipt the
// passes-to-play delta. Honest: if warm doesn't help, the ledger says so.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runResonance, deterministicSkin, sha256 } from "./core.mjs";
import { FieldMemory, warmStart, findSimilarField } from "./field-memory.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const seedOf = (s, r) => s + "-" + r;

async function campaign(seed, memory) {
  const ws = warmStart(memory, seed);
  const res = await runResonance({
    seed,
    startField: ws.field,
    skinFn: async (f) => ({ text: deterministicSkin(f, seed), llm: false }),
  });
  return { seed, res, warmFrom: ws.from, warmDistance: ws.distance ?? null };
}

const memory = new FieldMemory();
const rows = [];

// Phase 1 — fill the memory (cold)
const P1 = ["oak-1", "oak-2", "ferry-1", "ferry-2"];
for (const s of P1) {
  const { res } = await campaign(s, memory);
  memory.add(s, res.field, { passes: res.rows.length, resonance: res.resonance });
  rows.push({ phase: 1, seed: s, mode: "cold", passes: res.rows.length, played: res.played });
}

// Phase 2 — new shapes: SAME seed both arms; the only difference is the
// start field. Warm arm looks up the memory by the seed itself. Pairs where
// the memory had no near hit (warmFrom=cold) are receipted but EXCLUDED
// from the saved tally — a cold-vs-cold difference is noise, not signal.
const P2 = ["oak-3", "ferry-3", "driftwood-1"];
for (const s of P2) {
  const probe = warmStart(memory, s);
  const cold = await runResonance({ seed: s, skinFn: async (f) => ({ text: deterministicSkin(f, s), llm: false }) });
  const warm = await runResonance({
    seed: s, startField: probe.field,
    skinFn: async (f) => ({ text: deterministicSkin(f, s), llm: false }),
  });
  const warmish = probe.from !== "cold";
  rows.push({ phase: 2, seed: s, mode: "cold", passes: cold.rows.length, played: cold.played, finalField: { ...cold.field } });
  rows.push({
    phase: 2, seed: s, mode: "warm", passes: warm.rows.length, played: warm.played,
    warmFrom: probe.from, warmDistance: probe.distance ?? null, counted: warmish,
    passesSaved: warmish ? cold.rows.length - warm.rows.length : null,
  });
}

// receipt chain
const ledger = rows.map((r, i) => { r.prev_tip = i ? rows[i - 1].tip : "0".repeat(12); r.tip = sha256(JSON.stringify(r)).slice(0, 12); return r; });
fs.mkdirSync(path.join(HERE, "receipts"), { recursive: true });
for (const r of rows) {
  console.log(`p${r.phase} ${r.seed.padEnd(14)} ${r.mode.padEnd(5)} passes=${String(r.passes).padStart(2)} played=${r.played}${r.mode === "warm" ? ` from=${r.warmFrom} d=${r.warmDistance} saved=${r.passesSaved}` : ""}`);
}
const saved = rows.filter((r) => r.mode === "warm" && r.counted).reduce((a, r) => a + r.passesSaved, 0);
console.log(`total passes saved by warm-start (text-lookup, counted pairs only): ${saved}`);

// Phase 3 — field-signature warm start: the honest key is the tuned field
// itself. For each phase-2 seed, look up the memory by the COLD arm's final
// field ("drums that tuned like this one"), then re-run warm. This is the
// production flow: every new shape runs cold ONCE; every later run of that
// shape starts from its field signature.
for (const s of P2) {
  const coldRow = rows.find((r) => r.phase === 2 && r.seed === s && r.mode === "cold");
  const coldField = coldRow.finalField;
  const hit = findSimilarField(memory, coldField, 1)[0];
  const warm = await runResonance({
    seed: s, startField: hit ? hit.field : null,
    skinFn: async (f) => ({ text: deterministicSkin(f, s), llm: false }),
  });
  const row = {
    phase: 3, seed: s, mode: "warm-field", passes: warm.rows.length, played: warm.played,
    warmFrom: hit ? hit.seed : "cold", warmDistance: hit ? hit.fieldDistance : null,
    coldPasses: coldRow.passes, passesSaved: hit ? coldRow.passes - warm.rows.length : null,
  };
  row.prev_tip = rows[rows.length - 1].tip; row.tip = sha256(JSON.stringify(row)).slice(0, 12);
  rows.push(row);
  ledger.push(row);
  console.log(`p3 ${s.padEnd(14)} warm-field passes=${String(row.passes).padStart(2)} (cold ${row.coldPasses}) from=${row.warmFrom} d=${row.warmDistance} saved=${row.passesSaved}`);
}
const saved3 = rows.filter((r) => r.mode === "warm-field").reduce((a, r) => a + r.passesSaved, 0);
console.log(`total passes saved by field-signature warm-start: ${saved3}`);
fs.writeFileSync(path.join(HERE, "receipts", "warm-start.jsonl"), ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log("receipted -> receipts/warm-start.jsonl");
