// field-memory.mjs — Bridge 2 (WP-11): warm-started resonance.
// Every tuned field is indexed as a memory cell (simple hashed embedding +
// cosine search, the jev-turbovec pattern). A new campaign can ask the
// memory for the nearest past field and BEGIN from it — passes saved are
// receipted against the cold-start baseline.
import { sha256, round6, xorshift32, CHANNELS } from "./core.mjs";

const DIM = 64;
function fnv1a(text) {
  let h = 0xcbf29ce484222325n;
  for (const b of Buffer.from(String(text), "utf8")) {
    h ^= BigInt(b); h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h;
}
export function embed(text, dim = DIM) {
  const v = new Array(dim).fill(0);
  for (const w of String(text).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)) {
    const h = fnv1a(w);
    v[Number(h % BigInt(dim))] += 1;
  }
  const n = Math.sqrt(v.reduce((a, x) => a + x * x, 0));
  return n > 0 ? v.map((x) => x / n) : v;
}
function cosine(a, b) {
  let d = 0;
  for (let i = 0; i < a.length; i++) d += a[i] * b[i];
  return d;
}

export class FieldMemory {
  constructor() { this.cells = []; }
  add(seed, field, meta = {}) {
    const cell = {
      seed, field: { ...field },
      vector: embed(seed + "|" + CHANNELS.map((k) => field[k] ?? 0).join(",")),
      meta, cell_id: sha256(seed + JSON.stringify(field)).slice(0, 16),
    };
    this.cells.push(cell);
    return cell.cell_id;
  }
  findSimilar(query, k = 1) {
    const v = embed(query);
    return this.cells
      .map((c) => ({ ...c, distance: round6(1 - cosine(v, c.vector)) }))
      .sort((a, b) => a.distance - b.distance)
      .slice(0, k);
  }
}

// warmStart: pick the nearest past field for a seed, if it is near enough
// (distance <= maxDistance), else cold-start. Returns { field, from }.
export function warmStart(memory, seed, { maxDistance = 0.75 } = {}) {
  if (!memory || memory.cells.length === 0) return { field: null, from: "cold" };
  const hit = memory.findSimilar(seed, 1)[0];
  if (hit && hit.distance <= maxDistance) return { field: { ...hit.field }, from: hit.seed, distance: hit.distance };
  return { field: null, from: "cold" };
}

// Field-signature search: cosine over the 3-dim tuned field itself —
// "drums that tuned like this one." Text embeddings are a weak proxy for
// field kinship (oak-3 vs oak-1 missed; driftwood~oak caught by luck);
// the field vector is the honest key.
export function findSimilarField(memory, field, k = 1) {
  const q = CHANNELS.map((c) => field[c] ?? 0);
  const nq = Math.sqrt(q.reduce((a, x) => a + x * x, 0)) || 1;
  return memory.cells
    .map((c) => {
      const v = CHANNELS.map((ch) => c.field[ch] ?? 0);
      const nv = Math.sqrt(v.reduce((a, x) => a + x * x, 0)) || 1;
      const d = q.reduce((a, x, i) => a + (x / nq) * (v[i] / nv), 0);
      return { ...c, fieldDistance: round6(1 - (d + 1) / 2) };
    })
    .sort((a, b) => a.fieldDistance - b.fieldDistance)
    .slice(0, k);
}
