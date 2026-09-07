import { writeFileSync } from "node:fs";

const lines = [
  "AVTALE OM LEVERANSE AV MOBILABONNEMENT",
  "",
  "Mellom: Telenor Norge AS (Leverandoren)",
  "Og: Gul Stein ENK, org.nr 999 888 777 (Kunden)",
  "",
  "1. AVTALENS VARIGHET",
  "Avtalen trer i kraft 1. mars 2025 og loper i en bindingsperiode",
  "paa 12 maaneder, det vil si frem til 1. mars 2026.",
  "",
  "2. FORNYELSE",
  "Etter utlopet av bindingsperioden fornyes avtalen automatisk",
  "for 12 maaneder av gangen, med fornyelsesdato 1. mars hvert aar.",
  "",
  "3. OPPSIGELSE",
  "Avtalen kan sies opp skriftlig med 3 maaneders varsel foer",
  "fornyelsesdato. Oppsigelse sendes til kundeservice@telenor.no.",
  "",
  "4. PRIS",
  "Manedlig avgift er kr 399 inkl. mva. Prisen kan justeres aarlig.",
  "",
  "Sted og dato: Oslo, 24. februar 2025",
];

// Minimal enkeltsides-PDF (Helvetica 11pt).
function esc(s){return s.replace(/\\/g,"\\\\").replace(/\(/g,"\\(").replace(/\)/g,"\\)");}
let y = 780;
let stream = "BT\n/F1 11 Tf\n14 TL\n72 " + y + " Td\n";
for (const l of lines) stream += "(" + esc(l) + ") Tj\nT*\n";
stream += "ET";

const objs = [];
objs[1] = "<< /Type /Catalog /Pages 2 0 R >>";
objs[2] = "<< /Type /Pages /Kids [3 0 R] /Count 1 >>";
objs[3] = "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>";
objs[4] = "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>";
objs[5] = "<< /Length " + Buffer.byteLength(stream) + " >>\nstream\n" + stream + "\nendstream";

let pdf = "%PDF-1.4\n";
const offsets = [];
for (let i = 1; i < objs.length; i++) {
  offsets[i] = Buffer.byteLength(pdf);
  pdf += i + " 0 obj\n" + objs[i] + "\nendobj\n";
}
const xrefStart = Buffer.byteLength(pdf);
pdf += "xref\n0 " + objs.length + "\n0000000000 65535 f \n";
for (let i = 1; i < objs.length; i++) pdf += String(offsets[i]).padStart(10,"0") + " 00000 n \n";
pdf += "trailer\n<< /Size " + objs.length + " /Root 1 0 R >>\nstartxref\n" + xrefStart + "\n%%EOF";

writeFileSync(process.argv[2], Buffer.from(pdf, "latin1"));
console.log("skrev", process.argv[2], Buffer.byteLength(pdf), "bytes");
