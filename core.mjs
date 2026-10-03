// unspoken-resonance core — the dance between the spoken and the unspoken.
//
// A procedurally generated FRAME (the drum-frame: a grid of scene cells)
// is tuned by an UNSPOKEN chorus of three instruments — JEV (a judging field
// that deforms with every judgment), JEPA (a tiny predictor whose surprise
// points attention), and MOTH (quantum/seeded soft perturbation). Their
// nudges accumulate, resonate, and feed back until the field agrees with
// itself; only then is the frame SKINNED by one word-smith call.
//
// Laws:
//   1. THE FRAME THINKS. Structure is generated before any words exist.
//   2. THE CHORUS NUDGES, NEVER DICTATES. Every instrument speaks in
//      [-1,1] nudges; the field accumulates them with damping; the frame
//      drifts toward the field with damping. Conservation is receipted.
//   3. THE DRUM IS PLAYED ONLY WHEN TUNED. The skin (words) is applied when
//      resonance crosses threshold — the picture is ready for its skin.
//   4. EVERY NUDGE IS RECEIPTED. The spoken/unspoken budget is a fact of
//      the ledger: one word-smith call, many silent nudges.

import crypto from "node:crypto";

export const sha256 = (s) => crypto.createHash("sha256").update(s).digest("hex");
export const round6 = (x) => Math.round(x * 1e6) / 1e6;

// --------------------------------------------------------------- xorshift32
export function xorshift32(seedStr) {
  let h = 2166136261 >>> 0;
  for (const b of Buffer.from(String(seedStr), "utf8")) { h ^= b; h = Math.imul(h, 16777619) >>> 0; }
  let s = h || 0x9e3779b9;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >> 17; s ^= s << 5; s >>>= 0;
    return s / 4294967296;
  };
}

// ------------------------------------------------------------------ frame
// The drum-frame: W x H cells, each { light, motion, presence } in [0,1].
// Purely procedural — the unspoken world exists before anyone speaks.
export const FRAME_W = 4, FRAME_H = 3;
export const CHANNELS = ["light", "motion", "presence"];

export function makeFrame(seed) {
  const rnd = xorshift32("frame|" + seed);
  const cells = [];
  for (let i = 0; i < FRAME_W * FRAME_H; i++) {
    cells.push({ light: rnd(), motion: rnd(), presence: rnd() });
  }
  return { seed, cells, energy: frameEnergy(cells) };
}

export function frameEnergy(cells) {
  // total "loudness" of the frame — must be conserved under tuning
  let e = 0;
  for (const c of cells) for (const k of CHANNELS) e += c[k] * c[k];
  return round6(e);
}

// ------------------------------------------------------------------- chorus
// Instrument 1 — JEV: a judging field. It scores the frame's agreement with
// the accumulated field, and DEFORMS with every judgment (a rhizome: the
// judge is changed by judging). Output: one nudge per channel.
export function jevJudge(frame, field, mem) {
  const nudges = {}; let memDelta = 0;
  for (const k of CHANNELS) {
    let sum = 0;
    for (const c of frame.cells) sum += (c[k] - 0.5) * 2 * (field[k] ?? 0);
    const raw = Math.max(-1, Math.min(1, sum / frame.cells.length));
    nudges[k] = round6(raw);
    memDelta += Math.abs(raw);
  }
  // the rhizome deforms: memory decays and absorbs this judgment
  mem.norm = round6(0.9 * (mem.norm ?? 0) + 0.1 * Math.min(1, memDelta / CHANNELS.length));
  nudges._mem = mem.norm;
  return nudges;
}

// Instrument 2 — JEPA: a tiny per-channel linear predictor with EMA target.
// It predicts this pass's frame channel from the last; prediction SURPRISE
// (|pred - actual|) becomes the nudge — surprise points attention.
export function jepaPredictor() {
  const pred = {}; // channel -> last predicted mean
  return {
    predict(frame, pass) {
      const out = {}; let surprise = 0;
      for (const k of CHANNELS) {
        const mean = frame.cells.reduce((a, c) => a + c[k], 0) / frame.cells.length;
        const p = pred[k] ?? mean;                 // first pass: no surprise
        surprise += Math.abs(p - mean);
        out[k] = round6(Math.max(-1, Math.min(1, (p - mean) * 4)));
        pred[k] = 0.999 * (pred[k] ?? mean) + 0.001 * mean; // EMA target
      }
      out._surprise = round6(surprise / CHANNELS.length);
      out._pass = pass;
      return out;
    },
  };
}

// Instrument 3 — MOTH: soft perturbation. Live: quantum-random bits from the
// moth-seal service. Fallback: seeded draws. Honest about the source either
// way; the perturbation stays soft (amplitude 0.35 max).
export function mothNudges(seed, liveBits) {
  const out = { source: liveBits ? "mothquantum:comet" : "fallback:xorshift" };
  const bytes = liveBits ?? (() => { const r = xorshift32("moth|" + seed); return Array.from({ length: 32 }, () => Math.floor(r() * 256)); })();
  for (let i = 0; i < CHANNELS.length; i++) {
    const b = bytes[i % bytes.length] / 255;               // [0,1]
    out[CHANNELS[i]] = round6((b * 2 - 1) * 0.35);
  }
  return out;
}

// ---------------------------------------------------------------- resonance
// One pass: chorus nudges -> accumulate field (damped) -> drift frame toward
// field (damped, energy-conserving) -> resonance = field self-agreement.
export function resonatePass(frame, field, chorus, opts) {
  const dampF = opts?.fieldDamp ?? 0.85, dampC = opts?.cellDamp ?? 0.12;
  const receipts = { nudges: {}, energyBefore: frame.energy };
  for (const k of CHANNELS) {
    // accumulate: damped sum of the three instruments' nudges
    const n = (chorus.jev[k] ?? 0) + (chorus.jepa[k] ?? 0) + (chorus.moth[k] ?? 0);
    field[k] = round6(dampF * (field[k] ?? 0) + (1 - dampF) * Math.max(-1, Math.min(1, n / 3)));
    receipts.nudges[k] = { jev: chorus.jev[k], jepa: chorus.jepa[k], moth: chorus.moth[k], field: field[k] };
    receipts.fieldAfter = receipts.fieldAfter || {};
    receipts.fieldAfter[k] = field[k];
  }
  // drift the frame toward the field, then renormalize to conserve energy
  for (const c of frame.cells) {
    for (const k of CHANNELS) {
      c[k] = Math.max(0, Math.min(1, c[k] + dampC * (field[k] - (c[k] - 0.5) * 2)));
    }
  }
  const e0 = frameEnergy(frame.cells);
  if (e0 > 0) {
    const target = frame.energy ?? e0, scale = Math.sqrt(target / e0);
    for (const c of frame.cells) for (const k of CHANNELS) c[k] = Math.max(0, Math.min(1, c[k] * scale));
  }
  frame.energy = frameEnergy(frame.cells);
  receipts.energyAfter = frame.energy;
  receipts.energyDrift = round6(Math.abs(frame.energy - receipts.energyBefore));
  return receipts;
}

export function fieldAgreement(a, b) {
  // cosine similarity over channels, squashed to [0,1]
  let dot = 0, na = 0, nb = 0;
  for (const k of CHANNELS) { dot += (a[k] ?? 0) * (b[k] ?? 0); na += (a[k] ?? 0) ** 2; nb += (b[k] ?? 0) ** 2; }
  if (na === 0 && nb === 0) return 1;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb) || 1);
  return round6((cos + 1) / 2);
}

// ------------------------------------------------------------------ skin
// Deterministic skin: the last-mile word-smith, offline. The field chooses
// the register; a small lexicon stretches the skin over the drum.
const REG = {
  light:   { hi: ["lit clear through", "noon-pale", "bright as struck brass"], lo: ["dusk-dim", "lamp-shadowed", "under a low sky"] },
  motion:  { hi: ["everything leaning into motion", "restless", "mid-gesture"], lo: ["held still", "breath-slow", "at anchor"] },
  presence:{ hi: ["crowded with company", "peopled to the corners", "attended"], lo: ["empty of everyone", "self-communed", "alone with its hum"] },
};
export function deterministicSkin(field, seed) {
  const pick = (arr, s) => arr[Math.floor(xorshift32(s)() * arr.length) % arr.length];
  const parts = CHANNELS.map((k) => {
    const v = field[k] ?? 0;
    return v >= 0 ? pick(REG[k].hi, seed + k) : pick(REG[k].lo, seed + k);
  });
  return `A scene ${parts[0]}, ${parts[1]}, ${parts[2]}. The frame holds; the words are only its skin.`;
}

// ------------------------------------------------------------------- engine
export const RESONANCE_THRESHOLD = 0.82;
export const PASSES_MAX = 24;

export async function runResonance({ seed, chorusLive, skinFn, threshold = RESONANCE_THRESHOLD, passesMax = PASSES_MAX }) {
  const frame = makeFrame(seed);
  const field = {};
  const mem = {}; // JEV rhizome memory
  const jepa = jepaPredictor();
  const rows = [];
  let resonance = 0, prevField = null, played = false, playedAt = null;

  for (let pass = 1; pass <= passesMax; pass++) {
    const jev = jevJudge(frame, field, mem);
    const jep = jepa.predict(frame, pass);
    const moth = chorusLive?.moth ? await chorusLive.moth() : mothNudges(seed, null);
    const chorus = { jev, jepa: jep, moth };
    const rec = resonatePass(frame, field, chorus);
    rec.pass = pass;
    rec.jevMem = jev._mem;
    rec.jepaSurprise = jep._surprise;
    rec.mothSource = moth.source;
    if (prevField) {
      resonance = fieldAgreement(field, prevField);
      rec.resonance = resonance;
      // the drum must be TUNED, not muffled: a field collapsed to zero is
      // maximally self-agreeing and perfectly dead. Require weight.
      const weight = Math.sqrt(CHANNELS.reduce((a, k) => a + (field[k] ?? 0) ** 2, 0) / CHANNELS.length);
      rec.fieldWeight = round6(weight);
      if (resonance >= threshold && weight > 0.05) { played = true; playedAt = pass; rows.push(rec); break; }
    }
    prevField = { ...field };
    rows.push(rec);
  }

  const skin = await skinFn(field, { played, playedAt, resonance });
  return { frame, field, rows, resonance, played, playedAt, skin, threshold };
}
