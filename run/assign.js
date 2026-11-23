// Teaching assignments from the command line.
// Usage: node run/assign.js examples/anonymized-ay26-27/anonymized-ay26-27.xlsx     (one workbook with a tab per table)
//    or: node run/assign.js examples/anonymized-ay26-27/*.csv                (one file per table)
import { readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import loadHighs from "highs";
import { readTables, buildData } from "../src/inputs.js";
import { readCuAesTables } from "../cu-aes/inputs.js";
import { solveAssignment, tcByRank, loadDifferences, toCSV } from "../src/solve.js";
import { constraints, objectives } from "../rules/assignment.js";

const XLSX = createRequire(import.meta.url)("xlsx");
const files = process.argv.slice(2).map((name) => ({ name, bytes: readFileSync(name) }));
const cuAes = readCuAesTables(XLSX, files);  // null unless these are the CU AES staff files
const { data, warnings } = buildData(cuAes ? cuAes.tables : readTables(XLSX, files));
for (const warning of [...warnings, ...(cuAes?.warnings ?? [])]) console.log(warning.startsWith("Recommended") ? warning : "Warning: " + warning);

const highs = await loadHighs();
const { rows, loads } = solveAssignment(highs, data, constraints, objectives, console.log);

for (const l of loadDifferences(loads)) {
    console.log(`Load: ${l.faculty} teaches ${l.tc.toFixed(2)} TC, ${Math.abs(l.difference).toFixed(2)} ${l.difference > 0 ? "over" : "under"}`);
}
const totals = tcByRank(rows);
console.log("\nTC by rank: " + Object.keys(totals).map((r) => `${r}: ${totals[r].toFixed(2)}`).join("   "));
writeFileSync("assignments.csv", toCSV(rows));
console.log(`Wrote assignments.csv (${rows.length} rows, ${rows.filter((r) => r.sections === 0).length} of them courses not taught)`);
