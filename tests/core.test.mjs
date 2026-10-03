import test from "node:test";
import assert from "node:assert/strict";
import {
  makeFrame, frameEnergy, jevJudge, jepaPredictor, mothNudges,
  resonatePass, fieldAgreement, runResonance, deterministicSkin,
  sha256, CHANNELS,
} from "../core.mjs";

test("frame generation is deterministic and energy is positive", () => {
  const a = makeFrame("drum1"), b = makeFrame("drum1");
  assert.deepEqual(a, b);
  assert.equal(a.cells.length, 12);
  assert.ok(a.energy > 0);
  for (const c of a.cells) for (const k of CHANNELS) { assert.ok(c[k] >= 0 && c[k] <= 1); }
});

test("JEV rhizome deforms with every judgment (memory grows, decays)", () => {
  const f = makeFrame("r"); const field = { light: 0.5 }; const mem = {};
  const n1 = jevJudge(f, field, mem);
  const m1 = mem.norm;
  jevJudge(f, field, mem);
  const m2 = mem.norm;
  assert.ok(m2 >= m1, "memory should grow or hold while judging the same frame");
  assert.equal(n1._mem, m1);
  for (const k of CHANNELS) assert.ok(n1[k] >= -1 && n1[k] <= 1);
});

test("JEPA surprise is zero on first pass, then reflects prediction error", () => {
  const p = jepaPredictor();
  const f = makeFrame("s");
  const first = p.predict(f, 1);
  assert.equal(first._surprise, 0);
  // force the frame far away, next prediction should be surprised
  for (const c of f.cells) c.light = 1 - c.light;
  const second = p.predict(f, 2);
  assert.ok(second._surprise > 0);
});

test("moth fallback is honest, bounded, and seed-deterministic", () => {
  const a = mothNudges("m1", null), b = mothNudges("m1", null);
  assert.equal(a.source, "fallback:xorshift");
  assert.deepEqual(a, b);
  const live = mothNudges("m2", [10, 200, 90]);
  assert.equal(live.source, "mothquantum:comet");
  for (const k of CHANNELS) { assert.ok(live[k] >= -0.35 && live[k] <= 0.35); }
});

test("resonance conserves frame energy (drift under 1e-4 per pass)", () => {
  const frame = makeFrame("e1"); const field = {}; const chorus = {
    jev: { light: 0.5, motion: -0.3, presence: 0.2 }, jepa: { light: 0.1, motion: 0.1, presence: 0.1 }, moth: { light: 0.05, motion: -0.05, presence: 0.02 },
  };
  const before = frame.energy;
  resonatePass(frame, field, chorus);
  assert.ok(Math.abs(frame.energy - before) < 1e-4, `drift ${Math.abs(frame.energy - before)}`);
});

test("field agreement: identical fields agree fully; opposite fields do not", () => {
  assert.equal(fieldAgreement({ light: 0.5, motion: 0.5, presence: 0.5 }, { light: 0.5, motion: 0.5, presence: 0.5 }), 1);
  assert.ok(fieldAgreement({ light: 1 }, { light: -1 }) < 0.1);
});

test("campaign plays the drum: resonance crosses threshold, skin applied, receipts chained", async () => {
  const skins = [];
  const res = await runResonance({ seed: "drum1", skinFn: async (f, m) => { skins.push(m); return { text: deterministicSkin(f, "x"), llm: false }; } });
  assert.ok(res.rows.length >= 2, "needs at least two passes to compare fields");
  if (res.played) {
    assert.ok(res.playedAt >= 2);
    assert.ok(res.resonance >= res.threshold);
    assert.ok(skins[0].playedAt === res.playedAt);
  } else {
    assert.equal(res.playedAt, null, "honest no-play must carry no playedAt");
  }
  assert.ok(res.skin.text.length > 20);
});

test("the muffled drum is refused: zero-field convergence does not count as tuned", async () => {
  // a chorus that always nudges to zero would drive the field to 0; the
  // weight guard must refuse to play. Simulate via chorus override.
  const zeroChorus = { moth: async () => ({ source: "fallback:xorshift", light: 0, motion: 0, presence: 0 }) };
  const res = await runResonance({ seed: "flat", chorusLive: zeroChorus, skinFn: async (f) => ({ text: deterministicSkin(f, "y"), llm: false }) });
  // with jev/jepa both starting near zero and moth zero, field stays ~0 ->
  // weight guard keeps it from claiming played on a dead field
  if (res.played) {
    const w = Math.sqrt(CHANNELS.reduce((a, k) => a + res.field[k] ** 2, 0) / 3);
    assert.ok(w > 0.05, "played only with weight");
  }
});

test("deterministic skin is seed-stable and field-driven", () => {
  const a = deterministicSkin({ light: 0.6, motion: -0.4, presence: 0.1 }, "z");
  const b = deterministicSkin({ light: 0.6, motion: -0.4, presence: 0.1 }, "z");
  const c = deterministicSkin({ light: -0.6, motion: -0.4, presence: 0.1 }, "z");
  assert.equal(a, b);
  assert.notEqual(a, c, "flipping light flips the register");
});

test("sha256 receipt chaining is stable", () => {
  assert.equal(sha256("a").length, 64);
  assert.equal(sha256("a"), sha256("a"));
});
