# unspoken-resonance

> **The dance between the spoken and the unspoken.** A procedurally generated
> drum-frame is tuned by a chorus of three silent instruments — JEV, JEPA,
> Moth — whose soft nudges add up, resonate, and feed back. When the field
> agrees with itself, the picture is ready for its skin to be stretched
> around the frame and the drum is played: **one** word-smith call.

## The four laws

1. **THE FRAME THINKS.** The world exists before words: a 4×3 grid of scene
   cells (light, motion, presence), generated deterministically from a seed.
   No model is asked what the scene should be.
2. **THE CHORUS NUDGES, NEVER DICTATES.** Every instrument speaks in [-1,1]
   nudges per channel. The field accumulates them with damping
   (F = 0.85·F + 0.15·nudge); the frame drifts toward the field, damped, and
   energy-conserving (drift receipted per pass, < 1e-4). Nothing is allowed
   to set a value by decree.
3. **THE DRUM IS PLAYED ONLY WHEN TUNED.** Resonance = field self-agreement
   (cosine between consecutive pass-fields, squashed to [0,1]). When
   resonance ≥ 0.82 **and** the field is not weightless (RMS > 0.05), the
   skin goes on. A field collapsed to zero is maximally self-agreeing and
   perfectly dead — the weight guard refuses to play a muffled drum.
4. **EVERY NUDGE IS RECEIPTED.** The spoken/unspoken budget is a fact of the
   ledger: many silent nudges, one spoken call, per-pass nudge and energy
   rows, sha-chained tips.

## The chorus (three instruments)

| instrument | what it is | what it contributes | what it gets back |
|---|---|---|---|
| **JEV** | a judging field (rhizome) | frame-vs-field agreement nudge per channel | its own memory deforms with every judgment (`jevMem` in receipts) |
| **JEPA** | tiny per-channel predictor (EMA target, τ=0.999) | prediction **surprise** as attention — where the world model is wrong, the frame gets nudged | its surprise shrinks as the field settles |
| **MOTH** | comet-qrng certified randomness | soft perturbation, amplitude ≤ 0.35 — the quantum breath | an auditable commitment hash (circuit, backend, salt) bound into the receipt |

The moth instrument calls `api.mothquantum.com/api/v1/engines/comet-qrng-v1/process`
(wave-67 API; async 202 → poll `/api/v1/jobs/{id}/result` →
`result.output.random.hex`). Fallback is seeded xorshift, honestly labeled
`fallback:xorshift` vs `mothquantum:comet` in every receipt.

## The receipted campaign (live)

Five seeds offline (deterministic) + three seeds live (quantum moth + LLM
skin). Every live campaign played the drum:

| seed | passes to tune | final resonance | moth | skin |
|---|---|---|---|---|
| nightfall | 5 | 0.9993 | ◆ quantum (commit c47b6725…) | LLM |
| harbor | 6 | 0.9994 | ◆ quantum (commit c47b6725…) | LLM |
| drift | 5 | 0.9998 | ◆ quantum (commit c47b6725…) | LLM |

The skins are prose visibly shaped by the field: `nightfall` tuned dark and
still ("a lamp… as if remembering it had once been brighter"), `drift` tuned
thin and pale ("light hung thin, barely enough to blush the dust motes").
One spoken call each; ~15-30 silent nudges each.

## Layout

- `core.mjs` — frame, chorus (jev/jepa/moth), resonance loop, energy
  conservation, deterministic skin, receipt chaining.
- `run.mjs` — receipted campaigns; `--live` = quantum moth + real LLM skin
  via DeepInfra (`Qwen/Qwen3-Next-80B-A3B-Instruct`).
- `tests/core.test.mjs` — 10 tests: determinism, rhizome deformation, JEPA
  surprise, moth honesty + bounds, energy conservation, field agreement,
  drum-play condition, **the muffled-drum refusal**, skin register-flipping,
  receipt chaining.
- `demo/index.html` — self-contained player (no network): watch the chorus
  tune the drum pass by pass, instrument bars for all three voices + the
  field, the resonance readout, the skin fading in when the drum plays, and
  the bundled live receipts. `tools/bundle-demo.mjs` injects the ledger.

## Run it

```bash
node run.mjs                          # offline campaign (5 seeds)
node run.mjs --live --seeds a,b,c     # quantum moth + LLM skin
node --test tests/core.test.mjs       # 10/10
node tools/bundle-demo.mjs            # rebuild the demo page
```

## Why this matters (the beyond-the-horizon note)

Diffusion gives you the whole picture at once, then asks a captioner what it
was. Here the picture is built **as** a negotiation: structure proposes,
unspoken instruments dispose, and language arrives last, as clothing. The
same chorus shape works wherever a "last-mile" layer sits on top of a
deterministic frame — prose, music arrangement, level design, UI themes.
The unspoken layer is where JEV, JEPA and certified randomness compose
without a single word being spent.

## Honest limits

- The resonance metric rewards stability; a chorus could learn to agree with
  itself quickly on a boring field (the weight guard is a first defense, not
  a full answer — a diversity term is future work, shared with madlibs-jev's
  compile lesson).
- The frame's drift rule is a simple damped pull; real "tuning" wants the
  Perona-Malik diffusion from quilt-jepa so surprise pools instead of
  smoothing.
- Live moth bits are emu-mode (Aer simulator baseline, honestly uncertified);
  qpu mode is one parameter away but costs quota.
