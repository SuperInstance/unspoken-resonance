// tests/spec.test.mjs — the pre-registration contract.
//
// Commit 1 (expectation FIRST) carried the spec-file tests below: the spec
// exists, is well-formed, its formula string is pinned verbatim, and its
// spec_sha is stable under canon (reformat/reorder-insensitive, value-
// sensitive). Commit 2 (implementation) joins the contract tests: mothAmp,
// diversity, the end-to-end runWarmExperiment receipt, and the --check mode.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { canon, sha256, mothNudges, mothAmp, xorshift32, round6, fieldAgreement, CHANNELS } from "../core.mjs";
import { diversity } from "../field-memory.mjs";
import { runWarmExperiment } from "../run-warm.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const SPEC_PATH = path.join(HERE, "..", "spec", "invariants.json");
const HEX64 = /^[0-9a-f]{64}$/;

test("pre-registered spec exists and is well-formed (expectation before implementation)", () => {
  const spec = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  assert.equal(spec.spec, "unspoken-resonance.warmstart.invariants");
  assert.equal(spec.version, 1);
  assert.ok(Array.isArray(spec.invariants) && spec.invariants.length === 2);
  const ids = spec.invariants.map((i) => i.id);
  assert.deepEqual([...ids].sort(), ["cross-seed-diversity", "moth-breath-scaling"]);
  const div = spec.invariants.find((i) => i.id === "cross-seed-diversity");
  assert.ok(div.metric.includes("mean pairwise field distance"));
  assert.ok(div.metric.includes("1 - fieldAgreement"));
  assert.ok(div.floor.includes("0.8") && div.floor.includes("COLD arm"));
  for (const inv of spec.invariants) {
    assert.ok(inv.derivation.length > 60, `${inv.id} needs a real derivation`);
  }
  const moth = spec.invariants.find((i) => i.id === "moth-breath-scaling");
  assert.match(moth.formula, /clamp\(0\.35 \* \(1 \+ 0\.5 \* closeness\), 0\.35, 0\.5\)/);
  assert.match(moth.formula, /closeness = 1 - warmDistance/);
});

test("spec_sha = sha256(canon(spec)): reorder/whitespace-stable, value-sensitive", () => {
  const raw = JSON.parse(fs.readFileSync(SPEC_PATH, "utf8"));
  const sha = sha256(canon(raw));
  assert.match(sha, HEX64);
  // rebuild with different top-level key order + no whitespace: same canon,
  // same hash. (The invariants ARRAY stays ordered — canon sorts object keys,
  // it must not sort list elements; the registered order is part of the
  // expectation.)
  const reordered = {
    spec_sha_note: raw.spec_sha_note,
    invariants: raw.invariants,
    version: raw.version,
    spec: raw.spec,
  };
  assert.equal(sha256(canon(reordered)), sha, "canon must be key-order/whitespace insensitive");
  // a single value edit must move the hash (the whole point of sealing)
  const tampered = structuredClone(raw);
  tampered.invariants[0].floor = ">= 0.5 x the COLD arm (weakened — must not hash the same)";
  assert.notEqual(sha256(canon(tampered)), sha);
  const capped = structuredClone(raw);
  capped.invariants[1].formula = "amp(closeness) = clamp(0.35 * (1 + 0.5 * closeness), 0.35, 0.9)";
  assert.notEqual(sha256(canon(capped)), sha, "cap edits are visible");
});

// --------------------------------------- implementation contract (commit 2)
test("default moth breath is untouched: no opts == the historical 0.35 behavior", () => {
  const a = mothNudges("spec-m", null), b = mothNudges("spec-m", null, { amp: 0.35 });
  assert.deepEqual(a, b, "opts.amp defaults to the historical 0.35");
  // pinned against the raw seeded draws (the pre-change formula, verbatim)
  const r = xorshift32("moth|spec-m");
  const bytes = Array.from({ length: 32 }, () => Math.floor(r() * 256));
  for (let i = 0; i < CHANNELS.length; i++) {
    assert.equal(a[CHANNELS[i]], round6((bytes[i] / 255 * 2 - 1) * 0.35));
    assert.ok(Math.abs(a[CHANNELS[i]]) <= 0.35);
  }
  // a bigger breath scales the SAME draws linearly (amplitude enters as (b*2-1)*amp)
  const big = mothNudges("spec-m", null, { amp: 0.5 });
  assert.equal(big.light, round6((bytes[0] / 255 * 2 - 1) * 0.5));
});

test("moth-breath-scaling matches the registered formula (floor 0.35, cap 0.5)", () => {
  assert.equal(mothAmp(0), 0.35, "cold start: base breath preserved");
  assert.equal(mothAmp(0.4), 0.42, "0.35 * 1.2");
  assert.equal(mothAmp(1), 0.5, "cap pre-registered at 0.5 (0.525 clamped)");
  assert.equal(mothAmp(-0.5), 0.35, "closeness below zero clamps to the floor");
  for (let c = -1; c <= 1.0001; c += 0.05) {
    const v = mothAmp(c);
    assert.ok(v >= 0.35 && v <= 0.5, `amp(${c.toFixed(2)})=${v} inside [0.35, 0.5]`);
  }
  assert.ok(mothAmp(0.2) < mothAmp(0.8), "monotone: nearer warm-start, bigger breath");
});

test("diversity: mean pairwise field distance, null when unmeasurable", () => {
  const A = { light: 0.5, motion: 0.2, presence: -0.3 };
  assert.equal(diversity([A, A]), 0, "identical fields are zero-distance");
  assert.equal(diversity([]), null, "empty: nothing measured");
  assert.equal(diversity([A]), null, "single field: no pairs");
  const B = { light: -0.6, motion: 0.4, presence: 0.1 };
  const C = { light: 0.1, motion: -0.9, presence: 0.7 };
  assert.ok(diversity([A, B]) > 0, "distinct fields are > 0 apart");
  const d3 = diversity([A, B, C]);
  // recompute honestly: mean over the 3 unordered pairs
  const expect = round6((round6(1 - fieldAgreement(A, B)) + round6(1 - fieldAgreement(A, C)) + round6(1 - fieldAgreement(B, C))) / 3);
  assert.equal(d3, expect);
  // fields proportional in the same direction agree fully -> distance 0, honestly
  assert.equal(diversity([{ light: 1 }, { light: 0.5 }]), 0, "cosine is direction, not magnitude");
});

test("runWarmExperiment end-to-end: spec_sha + mothAmp on every row, invariants row present", async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "warm-"));
  const outPath = path.join(dir, "warm-start.jsonl");
  const { rows, serialized, specSha, verdict } = await runWarmExperiment({ outPath });
  assert.match(specSha, HEX64);
  assert.equal(specSha, sha256(canon(JSON.parse(fs.readFileSync(SPEC_PATH, "utf8")))), "spec_sha binds the committed spec");
  assert.ok(rows.length >= 14, "13 experiment rows + 1 invariants summary");
  for (const r of rows) {
    assert.equal(r.spec_sha, specSha, "every receipt row carries the expectation hash");
  }
  for (const r of rows.filter((x) => x.mode === "warm" || x.mode === "warm-field")) {
    assert.ok(typeof r.mothAmp === "number" && r.mothAmp >= 0.35 && r.mothAmp <= 0.5, `amp ${r.mothAmp} in budget`);
    const close = r.warmDistance == null ? 0 : 1 - r.warmDistance;
    assert.ok(Math.abs(r.mothAmp - mothAmp(close)) <= 1e-6, "recorded amp equals the registered formula at its closeness");
    assert.ok(r.finalField, "warm arms receipt their final fields (diversity evidence)");
  }
  const summary = rows[rows.length - 1];
  assert.equal(summary.phase, 4);
  assert.equal(summary.kind, "invariants");
  assert.equal(summary.spec_sha, specSha);
  assert.equal(summary.crossSeedDiversity.floor, "0.8");
  assert.equal(summary.crossSeedDiversity.pass, true, "warm arm stays within 0.8x of the cold control rung");
  assert.equal(summary.mothBreathScaling.pass, true);
  assert.equal(summary.verdict, "CANONIZED");
  assert.equal(verdict, "CANONIZED");
  assert.equal(fs.readFileSync(outPath, "utf8"), serialized, "outPath written = serialized receipt");
  // the file on disk is the receipt of record and --check must agree with it
  const chk = await runWarmExperiment({ checkPath: outPath });
  assert.equal(chk.check.match, true);
});

test("--check: exit 0 against the receipt of record; a tampered byte diverges with exit 1", async () => {
  const run = promisify(execFile);
  const receipt = path.join(HERE, "..", "receipts", "warm-start.jsonl");
  await run(process.execPath, [path.join(HERE, "..", "run-warm.mjs"), "--check"], { cwd: path.join(HERE, "..") }); // exit 0 or throws
  // tamper ONE byte in a temp copy — the recomputation must diverge
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "tamper-"));
  const bad = path.join(dir, "warm-start.jsonl");
  fs.writeFileSync(bad, fs.readFileSync(receipt, "utf8").replace("oak-3", "oak-X"));
  const chk = await runWarmExperiment({ checkPath: bad });
  assert.equal(chk.check.exists, true);
  assert.equal(chk.check.match, false);
  await assert.rejects(
    run(process.execPath, [path.join(HERE, "..", "run-warm.mjs"), "--check", bad], { cwd: path.join(HERE, "..") }),
    (e) => e.code === 1 && /DIVERGED/.test(e.stderr));
});
