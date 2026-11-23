// Solve the anonymized AY 26-27 example and check the result.   Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import loadHighs from "highs";
import { readTables, buildData } from "../src/inputs.js";
import { solveAssignment, tcByRank, loadDifferences } from "../src/solve.js";
import { constraints, objectives } from "../rules/assignment.js";

const XLSX = createRequire(import.meta.url)("xlsx");
const DIR = "examples/anonymized-ay26-27/";
const EXAMPLE = DIR + "anonymized-ay26-27.xlsx";
const EXPECTED = { 1: 44.5, 2: 9.5, 3: 6, 4: 13, 5: 1, 6: 1 };  // TC by preference rank
// Load deviation, then TC in unranked courses, choice #8, #7, ..., #2
const EXPECTED_GOALS = [0, 0, 0, 0, 1, 1, 13, 6, 9.5];

async function solve(files) {
    const { data, warnings } = buildData(readTables(XLSX, files));
    const { rows, stages, loads } = solveAssignment(await loadHighs(), data, constraints, objectives);
    const round = (v) => Math.round(v * 100) / 100;
    const totals = Object.fromEntries(Object.entries(tcByRank(rows)).map(([k, v]) => [k, round(v)]));
    return { totals, warnings, rows, loads, goals: stages.map((s) => round(s.value)) };
}

test("one workbook with a tab per table", async () => {
    const { totals, warnings, goals, rows, loads } = await solve([{ name: EXAMPLE, bytes: readFileSync(EXAMPLE) }]);
    assert.equal(warnings.length, 1);  // one survey answer names a course that is not in the list
    assert.deepEqual(totals, EXPECTED);
    assert.deepEqual(goals, EXPECTED_GOALS);
    assert.deepEqual(loadDifferences(loads), []);
    assert.equal(new Set(rows.map((r) => r.course)).size, 60);  // every course is listed, taught or not
    assert.equal(rows.filter((r) => r.sections === 0).length, 10);
});

test("one csv file per table", async () => {
    const names = readdirSync(DIR).filter((name) => name.endsWith(".csv"));
    const { totals } = await solve(names.map((name) => ({ name, bytes: readFileSync(DIR + name) })));
    assert.deepEqual(totals, EXPECTED);
});
