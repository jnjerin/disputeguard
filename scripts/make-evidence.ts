/**
 * PURPOSE
 * Generates the sample evidence files in evidence-samples/ (invented data, safe to publish):
 *   tracking-delivered.pdf   DHL confirmation: delivered and signed (wins an "item not received" claim)
 *   tracking-in-transit.pdf  carrier page: still in transit, no delivery scan (weak evidence)
 *   receipt.png              copied from the gate-check fixtures (Savanna Crafts, USD 48.50)
 * Judges and the demo upload these on a dispute's page. The evals use them too.
 *
 * A one-page text PDF is just text objects plus a byte-offset table ("xref"), so we build it by
 * hand (same technique as the gate-check spike) instead of adding a PDF library.
 * Run: npm run make:evidence
 */
import { copyFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "..");
const OUT = resolve(ROOT, "evidence-samples");

function pdf(lines: string[]): string {
  const text = lines.map((l, i) => `BT /F1 12 Tf 60 ${740 - i * 22} Td (${l.replace(/[()\\]/g, "\\$&")}) Tj ET`).join("\n");
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(text)} >>\nstream\n${text}\nendstream`,
  ];
  let out = "%PDF-1.4\n";
  const offsets: number[] = [];
  objects.forEach((body, i) => {
    offsets.push(Buffer.byteLength(out));
    out += `${i + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(out);
  out += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  out += offsets.map((o) => `${String(o).padStart(10, "0")} 00000 n \n`).join("");
  out += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return out;
}

writeFileSync(resolve(OUT, "tracking-delivered.pdf"), pdf([
  "DHL EXPRESS - PROOF OF DELIVERY",
  "Shipper: Savanna Crafts Ltd, 12 Moi Avenue, Nairobi",
  "Order: SC-10482   Ship date: 2026-10-20",
  "Item: Handwoven sisal basket (large) x1   Declared value: USD 48.50",
  "Tracking: 1Z999AA10123456784",
  "Delivered to: the buyer's PayPal shipping address (as listed on the order)",
  "Status: DELIVERED 2026-10-24 14:12, signed by: J. BUYER",
]), "latin1");

writeFileSync(resolve(OUT, "tracking-in-transit.pdf"), pdf([
  "POSTA KENYA - TRACKING STATUS",
  "Sender: Savanna Crafts Ltd, Nairobi",
  "Article: RR123456789KE   Posted: 2026-10-20",
  "Last scan: 2026-10-22 08:30 - Departed Nairobi sorting centre",
  "Status: IN TRANSIT. No delivery scan recorded.",
]), "latin1");

copyFileSync(resolve(ROOT, "spikes/gate-check/fixtures/receipt.png"), resolve(OUT, "receipt.png"));
console.log(`wrote evidence samples to ${OUT}`);
