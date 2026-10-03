#!/usr/bin/env node
// tools/bundle-demo.mjs — inject receipts into demo/index.html (idempotent).
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");
const ledgerFiles = ["../receipts/ledger.jsonl", "../receipts/ledger-live.jsonl"];
const rows = [];
for (const f of ledgerFiles) {
  const p = new URL(f, import.meta.url);
  if (fs.existsSync(p)) for (const l of read(p).split("\n")) if (l.trim()) rows.push(JSON.parse(l));
}
let html = read("../demo/index.html");
const re = /(<script id="bundled-receipts" type="application\/json">)[\s\S]*?(<\/script>)/;
if (!re.test(html)) throw new Error("placeholder #bundled-receipts not found");
html = html.replace(re, (_, open, close) => open + JSON.stringify(rows) + close);
fs.writeFileSync(new URL("../demo/index.html", import.meta.url), html);
console.log(`bundled ${rows.length} campaigns into demo/index.html`);
