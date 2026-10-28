// Writes fixtures/evidence.pdf: a one-page text PDF built by hand (no PDF library).
// receipt.png is made separately by make-receipt.ps1 (Windows System.Drawing).
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { PATHS } from "../src/lib/env.js";

const lines = [
  "SHIPPING CONFIRMATION - Evidence for dispute",
  "Merchant: Savanna Crafts Ltd",
  "Order: SC-10482   Date: 2026-10-20",
  "Item: Handwoven sisal basket (large) x1",
  "Amount: USD 48.50",
  "Carrier: DHL Express   Tracking: 1Z999AA10123456784",
  "Status: Delivered 2026-10-24 14:12, signed by: J. BUYER",
];

const text = lines
  .map((l, i) => `BT /F1 12 Tf 60 ${740 - i * 22} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`)
  .join("\n");

const objects = [
  "<< /Type /Catalog /Pages 2 0 R >>",
  "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
  "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
  "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
];

let pdf = "%PDF-1.4\n";
const offsets: number[] = [];
objects.forEach((body, i) => {
  offsets.push(Buffer.byteLength(pdf));
  pdf += `${i + 1} 0 obj\n${body}\nendobj\n`;
});
const xref = Buffer.byteLength(pdf);
pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
pdf += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;

const out = resolve(PATHS.fixtures, "evidence.pdf");
writeFileSync(out, pdf, "latin1");
console.log(`wrote ${out} (${Buffer.byteLength(pdf)} bytes)`);
