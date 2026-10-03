#!/usr/bin/env node
// run-warm.mjs — Bridge 2 A/B: cold-start vs warm-started resonance, now
// sealed with the PRE-REGISTERED warm-start invariants (spec/invariants.json,
// committed before this implementation — expectation first).
// Phase 1: run 4 cold campaigns, index every tuned field into FieldMemory.
// Phase 2: run 3 NEW seeds cold AND warm (same chorus seeds), receipt the
//          passes-to-play delta. Warm arms breathe harder: mothAmp scales
//          with closeness of the warm-start (pre-registered moth-breath-
//          scaling; cold probes keep the 0.35 base).
// Phase 3: field-signature warm start — the honest key is the tuned field
//          itself; the production flow (every new shape runs cold ONCE).
// Phase 4: the pre-registered invariants evaluated on the finished arms:
//          cross-seed-diversity (warm-arm mean pairwise field distance vs
//          the COLD control rung, floor 0.8x) + moth-breath-scaling (every
//          warm row's mothAmp must equal the registered formula). Breach ->
//          verdict INDETERMINATE, receipt kept, exit 1.
//
//   node run-warm.mjs                    # run + write receipts/warm-start.jsonl
//   node run-warm.mjs --check            # recompute in memory, byte-compare
//                                        # against the receipt of record, NEVER write
//   node run-warm.mjs --check <path>     # compare against that receipt file
//
// Deterministic: no wall-clock fields; spec_sha (sha256 of canon(spec)) rides
// in every row. A missing spec refuses the run BEFORE anything happens.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { runResonance, deterministicSkin, sha256, canon, round6, mothAmp } from "./core.mjs";
import { FieldMemory, warmStart, findSimilarField, diversity } from "./field-memory.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(HERE, "spec", "invariants.json");
const RECEIPT_PATH = path.join(HERE, "receipts", "warm-start.jsonl");
const seedOf = (s, r) => s + "-" + r;

function loadSpec() {
  if (!fs.existsSync(SPEC_PATH)) {
    throw new Error("NO INVARIANT SPEC — PRE-REGISTRATION IS MANDATORY (spec/invariants.json missing)");
  }
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  if (!spec || spec.spec !== "unspoken-resonance.warmstart.invariants" || !Array.isArray(spec.invariants)) {
    throw new Error("INVARIANT SPEC MALFORMED (spec/invariants.json): expected {spec:'unspoken-resonance.warmstart.invariants', invariants:[...]}");
  }
  return spec;
}

async function campaign(seed, memory) {
  const ws = warmStart(memory, seed);
  const res = await runResonance({
    seed,
    startField: ws.field,
    skinFn: async (f) => ({ text: deterministicSkin(f, seed), llm: false }),
  });
  return { seed, res, warmFrom: ws.from, warmDistance: ws.distance ?? null };
}

export async function runWarmExperiment({ outPath = null, checkPath = null } = {}) {
  const spec = loadSpec(); // pre-registration gate: refuses before anything runs
  const specSha = sha256(canon(spec));

  const memory = new FieldMemory();
  const rows = [];

  // Phase 1 — fill the memory (cold)
  const P1 = ["oak-1", "oak-2", "ferry-1", "ferry-2"];
  for (const s of P1) {
    const { res } = await campaign(s, memory);
    memory.add(s, res.field, { passes: res.rows.length, resonance: res.resonance });
    rows.push({ phase: 1, seed: s, mode: "cold", passes: res.rows.length, played: res.played, mothAmp: 0.35, spec_sha: specSha });
  }

  // Phase 2 — new shapes: SAME seed both arms; the only difference is the
  // start field. Warm arm looks up the memory by the seed itself. Pairs where
  // the memory had no near hit (warmFrom=cold) are receipted but EXCLUDED
  // from the saved tally — a cold-vs-cold difference is noise, not signal.
  // Anti-homogenization (pre-registered): the warm arm's moth breathes with
  // amp(closeness) = clamp(0.35 * (1 + 0.5 * closeness), 0.35, 0.5).
  const P2 = ["oak-3", "ferry-3", "driftwood-1"];
  for (const s of P2) {
    const probe = warmStart(memory, s);
    const cold = await runResonance({ seed: s, skinFn: async (f) => ({ text: deterministicSkin(f, s), llm: false }) });
    const closeness = probe.distance == null ? 0 : 1 - probe.distance;
    const warmAmp = round6(mothAmp(closeness));
    const warm = await runResonance({
      seed: s, startField: probe.field, mothAmp: warmAmp,
      skinFn: async (f) => ({ text: deterministicSkin(f, s), llm: false }),
    });
    const warmish = probe.from !== "cold";
    rows.push({ phase: 2, seed: s, mode: "cold", passes: cold.rows.length, played: cold.played, finalField: { ...cold.field }, mothAmp: 0.35, spec_sha: specSha });
    rows.push({
      phase: 2, seed: s, mode: "warm", passes: warm.rows.length, played: warm.played,
      finalField: { ...warm.field },
      warmFrom: probe.from, warmDistance: probe.distance ?? null, counted: warmish,
      passesSaved: warmish ? cold.rows.length - warm.rows.length : null,
      closeness: round6(closeness), mothAmp: warmAmp, spec_sha: specSha,
    });
  }

  const printWarm = (r) => r.mode === "warm"
    ? ` from=${r.warmFrom} d=${r.warmDistance} saved=${r.passesSaved} amp=${r.mothAmp}`
    : "";
  for (const r of rows) {
    console.log(`p${r.phase} ${r.seed.padEnd(14)} ${r.mode.padEnd(5)} passes=${String(r.passes).padStart(2)} played=${r.played}${printWarm(r)}`);
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
    const closeness = hit ? 1 - hit.fieldDistance : 0;
    const warmAmp = round6(mothAmp(closeness));
    const warm = await runResonance({
      seed: s, startField: hit ? hit.field : null, mothAmp: warmAmp,
      skinFn: async (f) => ({ text: deterministicSkin(f, s), llm: false }),
    });
    const row = {
      phase: 3, seed: s, mode: "warm-field", passes: warm.rows.length, played: warm.played,
      finalField: { ...warm.field },
      warmFrom: hit ? hit.seed : "cold", warmDistance: hit ? hit.fieldDistance : null,
      coldPasses: coldRow.passes, passesSaved: hit ? coldRow.passes - warm.rows.length : null,
      closeness: round6(closeness), mothAmp: warmAmp, spec_sha: specSha,
    };
    rows.push(row);
    console.log(`p3 ${s.padEnd(14)} warm-field passes=${String(row.passes).padStart(2)} (cold ${row.coldPasses}) from=${row.warmFrom} d=${row.warmDistance} saved=${row.passesSaved} amp=${row.mothAmp}`);
  }
  const saved3 = rows.filter((r) => r.mode === "warm-field").reduce((a, r) => a + r.passesSaved, 0);
  console.log(`total passes saved by field-signature warm-start: ${saved3}`);

  // Phase 4 — the pre-registered invariants, evaluated on the finished arms.
  // cross-seed-diversity: warm-arm final fields of P2 (distinct seeds) vs the
  // same over the COLD arm (control rung); floor 0.8x, receipted, and SKIP
  // (null) when an arm cannot be measured.
  const coldFields = rows.filter((r) => r.phase === 2 && r.mode === "cold").map((r) => r.finalField);
  const warmFields = rows.filter((r) => r.phase === 2 && r.mode === "warm").map((r) => r.finalField);
  const coldD = diversity(coldFields);
  const warmD = diversity(warmFields);
  const ratio = coldD == null || warmD == null ? null : round6(warmD / coldD);
  const divPass = coldD == null || warmD == null ? null : warmD >= 0.8 * coldD;
  // moth-breath-scaling: every warm-arm row's recorded mothAmp must equal the
  // registered formula evaluated at its own closeness.
  const warmRows = rows.filter((r) => r.mode === "warm" || r.mode === "warm-field");
  const mothViolations = [];
  for (const r of warmRows) {
    const close = r.warmDistance == null ? 0 : 1 - r.warmDistance;
    const want = mothAmp(close);
    if (r.mothAmp == null || Math.abs(r.mothAmp - want) > 1e-6) {
      mothViolations.push({ phase: r.phase, seed: r.seed, mothAmp: r.mothAmp ?? null, want: round6(want) });
    }
  }
  const mothPass = mothViolations.length === 0;
  const pass = divPass === true && mothPass;
  const summary = {
    phase: 4, kind: "invariants", spec_sha: specSha,
    crossSeedDiversity: { cold: coldD, warm: warmD, ratio, floor: "0.8", pass: divPass },
    mothBreathScaling: { checked: warmRows.length, violations: mothViolations, pass: mothPass },
    verdict: pass ? "CANONIZED" : "INDETERMINATE",
  };
  rows.push(summary);
  console.log(`p4 invariants spec_sha=${specSha.slice(0, 12)} cross-seed-diversity cold=${coldD} warm=${warmD} ratio=${ratio} floor=0.8 pass=${divPass} | moth-breath-scaling checked=${warmRows.length} pass=${mothPass} — verdict ${summary.verdict}`);

  // receipt chain — sequential tips, genesis = 12 zeros (unchanged scheme)
  for (let i = 0; i < rows.length; i++) {
    rows[i].prev_tip = i ? rows[i - 1].tip : "0".repeat(12);
    rows[i].tip = sha256(JSON.stringify(rows[i])).slice(0, 12);
  }
  const serialized = rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

  if (checkPath) {
    const exists = fs.existsSync(checkPath);
    const disk = exists ? fs.readFileSync(checkPath, "utf8") : null;
    return { rows, serialized, spec, specSha, verdict: summary.verdict, check: { path: checkPath, exists, match: exists && disk === serialized } };
  }
  if (outPath) {
    fs.mkdirSync(path.dirname(outPath), { recursive: true });
    fs.writeFileSync(outPath, serialized);
  }
  return { rows, serialized, spec, specSha, verdict: summary.verdict, wrote: outPath ?? null };
}

async function main() {
  const args = process.argv.slice(2);
  const checkIdx = args.indexOf("--check");
  try {
    if (checkIdx >= 0) {
      const arg = args[checkIdx + 1];
      const checkPath = arg && !arg.startsWith("--") ? path.resolve(arg) : RECEIPT_PATH;
      const { verdict, check } = await runWarmExperiment({ checkPath });
      if (!check.exists) {
        console.error(`--check REFUSED: receipt of record missing (${check.path}) — nothing was written`);
        process.exitCode = 1;
        return;
      }
      if (!check.match) {
        console.error(`--check DIVERGED: recomputed receipt is not byte-equal to ${check.path} — nothing was written`);
        process.exitCode = 1;
        return;
      }
      console.log(`--check OK: recomputed receipt is byte-equal to ${check.path}; invariants verdict ${verdict}`);
      if (verdict !== "CANONIZED") {
        console.error(`invariants verdict ${verdict}: the receipt of record breached its own pre-registration`);
        process.exitCode = 1;
      }
      return;
    }
    const { rows, verdict } = await runWarmExperiment({ outPath: RECEIPT_PATH });
    console.log("receipted -> receipts/warm-start.jsonl");
    if (verdict !== "CANONIZED") {
      console.error("INDETERMINATE: pre-registered invariants breached — receipt kept, refusing silent canonization (exit 1)");
      process.exitCode = 1;
    }
  } catch (e) {
    if (e.message.startsWith("NO INVARIANT SPEC") || e.message.startsWith("INVARIANT SPEC MALFORMED")) {
      console.error("WARM_RUN_REFUSED: " + e.message);
      process.exitCode = 1;
      return;
    }
    throw e;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) await main();
