#!/usr/bin/env node
// run.mjs — receipted resonance campaigns. Default: offline (seeded moth
// fallback, deterministic skin). --live: real moth bits + one real LLM skin
// via DeepInfra (keys read from /home/z/my-project/.env.keys, never printed).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  runResonance, deterministicSkin, sha256, round6, mothNudges, CHANNELS,
} from "./core.mjs";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf(k); return i > -1 ? process.argv[i + 1] : d; };
const LIVE = process.argv.includes("--live");
const SEEDS = (arg("--seeds", "drum1,drum2,drum3,drum4,drum5")).split(",");

function readKey(name) {
  const p = "/home/z/my-project/.env.keys";
  if (!fs.existsSync(p)) return null;
  const line = fs.readFileSync(p, "utf8").split("\n").find((l) => l.startsWith(name + "="));
  return line ? line.slice(name.length + 1).trim() : null;
}
function scrub(msg, ...keys) { let s = String(msg); for (const k of keys) if (k) s = s.split(k).join("[redacted]"); return s; }

async function fetchMothBits() {
  const key = readKey("MOTHQUANTUM_API_KEY");
  if (!key) return null;
  try {
    // wave-67 API: POST /api/v1/engines/comet-qrng-v1/process (async, 202),
    // then poll GET /api/v1/jobs/{id}/result until output exists.
    const r = await fetch("https://api.mothquantum.com/api/v1/engines/comet-qrng-v1/process", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ mode: "emu", params: { num_qubits: 12, shots: 2048, output_bytes: 16, bell_witness: false } }),
      signal: AbortSignal.timeout(20000),
    });
    const j = await r.json();
    const id = j.job_id || j.id;
    if (!id) return null;
    for (let i = 0; i < 12; i++) {
      await new Promise((res) => setTimeout(res, 2500));
      const p = await fetch(`https://api.mothquantum.com/api/v1/jobs/${id}/result`, { headers: { Authorization: `Bearer ${key}` }, signal: AbortSignal.timeout(10000) });
      if (!p.ok) continue;
      const pj = await p.json();
      const out = pj.result?.output ?? pj.output;
      const hex = out?.random?.hex;
      if (hex) {
        const bytes = bytesFromHex(String(hex));
        if (bytes) return { hex: String(hex), bytes, commit: out.commitment?.commit ?? null, backend: out.provenance?.backend ?? null };
      }
    }
    return null;
  } catch { return null; }
}
function bytesFromHex(hex) {
  const clean = hex.replace(/[^0-9a-f]/gi, "");
  const out = [];
  for (let i = 0; i + 1 < clean.length; i += 2) out.push(parseInt(clean.slice(i, i + 2), 16));
  return out.length ? out : null;
}

async function llmSkin(field, meta) {
  const key = readKey("DEEPINFRA_API_KEY");
  if (!key) return { text: deterministicSkin(field, "skin"), llm: false, reason: "no key" };
  const guide = CHANNELS.map((k) => `${k} ${(field[k] ?? 0).toFixed(3)}`).join(", ");
  const prompt = `You are the last-mile word-smith for a scene whose structure was already decided by an unspoken field. Do not change any fact; only clothe it. Field: ${guide}. Write exactly three sentences of prose that sit at this temperature.`;
  try {
    const r = await fetch("https://api.deepinfra.com/v1/openai/chat/completions", {
      method: "POST", headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({ model: "Qwen/Qwen3-Next-80B-A3B-Instruct", messages: [{ role: "user", content: prompt }], max_tokens: 220, temperature: 0.8 }),
      signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const j = await r.json();
    return { text: (j.choices?.[0]?.message?.content ?? "").trim(), llm: true, promptChars: prompt.length, model: "Qwen/Qwen3-Next-80B-A3B-Instruct" };
  } catch (e) {
    return { text: deterministicSkin(field, "skin"), llm: false, reason: scrub(e.message, key) };
  }
}

// ------------------------------------------------------------------- main
const ledger = [];
const tip = () => (ledger.length ? ledger[ledger.length - 1].tip : "0".repeat(12));
let liveBits = LIVE ? await fetchMothBits() : null;

for (const seed of SEEDS) {
  const res = await runResonance({
    seed,
    chorusLive: LIVE && liveBits ? { moth: async () => mothNudges(seed, liveBits.bytes) } : null,
    skinFn: LIVE ? llmSkin : async (f) => ({ text: deterministicSkin(f, seed), llm: false, reason: "offline campaign" }),
  });
  const row = {
    kind: "campaign", seed, passes: res.rows.length, played: res.played, playedAt: res.playedAt,
    resonance: res.resonance, threshold: res.threshold,
    finalField: { ...res.field }, finalEnergy: res.frame.energy,
    mothSource: res.rows[0]?.mothSource,
    mothLive: liveBits ? { hex: liveBits.hex, commit: liveBits.commit ?? null, backend: liveBits.backend ?? null } : null,
    skin: res.skin,
    prev_tip: tip(),
  };
  row.tip = sha256(JSON.stringify(row)).slice(0, 12);
  ledger.push(row);
  console.log(`campaign ${seed}: passes=${row.passes} played=${row.played}${row.playedAt ? "@p" + row.playedAt : ""} resonance=${row.resonance} skin.llm=${row.skin.llm}`);
}

const outDir = path.join(HERE, "receipts");
fs.mkdirSync(outDir, { recursive: true });
const file = path.join(outDir, LIVE ? "ledger-live.jsonl" : "ledger.jsonl");
fs.appendFileSync(file, ledger.map((r) => JSON.stringify(r)).join("\n") + "\n");
console.log(`receipted ${ledger.length} campaigns -> ${path.relative(HERE, file)} (${LIVE ? "LIVE" : "offline"} moth=${ledger[0].mothSource})`);
