// tests/spec.test.mjs — the pre-registration contract.
//
// Commit 1 (expectation FIRST) carries the spec-file tests below: the spec
// exists, is well-formed, its formula string is pinned verbatim, and its
// spec_sha is stable under canon (reformat/reorder-insensitive, value-
// sensitive). The implementation-contract tests (mothAmp, diversity,
// runWarmExperiment, --check) join commit 2, where the implementation lands —
// red-then-green is expressed by commit ORDER, never by a broken tree.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { canon, sha256 } from "../core.mjs";

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
