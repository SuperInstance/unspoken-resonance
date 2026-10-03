import test from "node:test";
import assert from "node:assert/strict";
import { FieldMemory, warmStart, findSimilarField, embed } from "../field-memory.mjs";

test("embed is deterministic and unit-norm", () => {
  const a = embed("oak-3|0.2,0.4,0.6"), b = embed("oak-3|0.2,0.4,0.6");
  assert.deepEqual(a, b);
  const n = Math.sqrt(a.reduce((s, x) => s + x * x, 0));
  assert.ok(n <= 1.000001);
});

test("memory add + findSimilar returns nearest by text key", () => {
  const m = new FieldMemory();
  m.add("oak-1", { light: 0.5, motion: 0.2, presence: 0.8 });
  m.add("ferry-1", { light: -0.3, motion: 0.6, presence: -0.1 });
  const hits = m.findSimilar("oak-1|0.5,0.2,0.8", 2);
  assert.equal(hits[0].seed, "oak-1");
  assert.ok(hits[0].distance < 0.01);
});

test("field-signature search finds the tuning family, not the name family", () => {
  const m = new FieldMemory();
  m.add("oak-1", { light: 0.4, motion: -0.1, presence: 0.2 });
  m.add("ferry-1", { light: -0.5, motion: 0.3, presence: -0.2 });
  const q = { light: -0.48, motion: 0.28, presence: -0.18 }; // near ferry-1's field
  const hit = findSimilarField(m, q, 1)[0];
  assert.equal(hit.seed, "ferry-1");
  assert.ok(hit.fieldDistance < 0.05);
});

test("warmStart returns cold when memory is empty or nothing is near", () => {
  const m = new FieldMemory();
  assert.equal(warmStart(m, "anything").from, "cold");
  m.add("x-1", { light: 0.9, motion: 0.9, presence: 0.9 });
  const far = warmStart(m, "completely-different-xyzzy", { maxDistance: 0.0001 });
  assert.equal(far.from, "cold");
});

test("warmStart returns a copy of the stored field (memory immutable to callers)", () => {
  const m = new FieldMemory();
  m.add("a-1", { light: 0.3, motion: 0.3, presence: 0.3 });
  const ws = warmStart(m, "a-1");
  ws.field.light = 99;
  assert.equal(m.cells[0].field.light, 0.3);
});
