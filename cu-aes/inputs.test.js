// Tests for the CU AES staff-file reader, on made-up files.   Run with: npm test
// These live in this folder so that removing cu-aes/ removes them too.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { createRequire } from "node:module";
import loadHighs from "highs";
import { readCuAesTables } from "./inputs.js";
import { buildData } from "../src/inputs.js";
import { solveAssignment } from "../src/solve.js";
import { constraints, objectives } from "../rules/assignment.js";

const XLSX = createRequire(import.meta.url)("xlsx");
const csv = (name, rows) => ({
    name,
    bytes: Buffer.from(rows.map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(",")).join("\n") + "\n"),
});

const SURVEY_COLUMNS = ["ResponseId", "RecordedDate", "Q Name", "Q Sabbatical/DTL",
    "Q1 _1", "Q2_1", "Q12", "Q3_1", "Q23", "Q4_1", "Q34 ", "Q5_1", "Q45", "Q73_1", "Q31", "Q81_1", "Q84", "Q82_1", "Q32"];
// answers: { column: value }; everything else is blank
const response = (answers) => SURVEY_COLUMNS.map((column) => answers[column] ?? "");
const TIE = "I am equally happy";

const survey = csv("Faculty Pref for AY 27-28_November 19, 2026.csv", [
    SURVEY_COLUMNS,
    SURVEY_COLUMNS.map((column) => "Question text for " + column),   // Qualtrics adds two extra heading rows
    SURVEY_COLUMNS.map((column) => `{"ImportId":"${column}"}`),
    // Ann's later response comes first in the file; it must still win.
    response({
        "RecordedDate": "11/19/2026 07:05", "Q Name": "ADAMS, ANN",
        "Q Sabbatical/DTL": "I will be unavailable for the Spring 2028 Semester",
        "Q1 _1": "Fall - ASEN 1000: Alpha (180 cap; 2 sections)",
        "Q2_1": "Spring - ASEN 2000: Beta (30 cap)", "Q12": TIE,
        "Q4_1": "Fall - ASEN 3000: Gamma", "Q34 ": TIE,              // #3 is blank: tie reaches up to #2
        "Q5_1": "Fall and Spring - ASEN 4018/4028: Senior Projects (Tech Support) (8 people)",
        "Q73_1": "Fall - Not Listed - please list specific course number in comments",
    }),
    response({ "RecordedDate": "11/01/2026 09:00", "Q Name": "ADAMS, ANN", "Q1 _1": "Spring - ASEN 2000: Beta (30 cap)" }),
    response({
        "RecordedDate": "11/02/2026 10:00", "Q Name": "BAKER, BOB",
        "Q Sabbatical/DTL": "I will be unavailable for the Fall 2027 Semester,I will be unavailable for the Spring 2028 Semester",
        "Q1 _1": "Spring - ASEN 2000: Beta (30 cap)", "Q2_1": "Spring - ASEN 2000: Beta (30 cap)",
    }),
    response({ "RecordedDate": "11/03/2026 10:00", "Q Name": "DOE, DEE", "Q1 _1": "Fall - ASEN 1000: Alpha" }),
]);
const faculty = csv("faculty list wTCs.csv", [
    ["Name", "uGrad TC", "Grad TC", "Total TC", "", "NOTES"],
    ["ADAMS, ANN", 1, 1, 2, "", ""], ["BAKER, BOB", 2, 0, 2, "", ""], ["CRUMB, CY", 1, 0, 1, "", "new"],
]);
const courses = csv("courses.csv", [
    ["Course", "Min TC", "Max TC", "TC Per Split", "Max TC per Faculty", "Notes"],
    ["Fall - ASEN 1000: Alpha", 1, 1, 1, 1, ""],
    ["Spring - ASEN 2000: Beta", 1, 1, 1, 1, ""],
    ["Fall - ASEN 3000 Gamma", 0, 1, 1, 1, ""],
    ["Fall and Spring - ASEN 4018/4028: Senior Projects (Course Director)", 0, 1, 1, 1, ""],
    ["Fall and Spring - ASEN 4018/4028: Senior Projects (Tech Support)", 0, 1, 1, 1, ""],
    ["Summer: ASEN 2000: Beta", 0, 1, 1, 1, ""],
]);
const forcings = csv("forcings.csv", [["Faculty", "Course", "Sections", "Notes"], ["CRUMB, CY", "Fall - ASEN 3000: Gamma (75 cap)", 1, ""]]);
const limits = csv("limits.csv", [["Type", "Courses", "Operator", "Limit"], ["Offering", "Fall - ASEN 1000: Alpha; Spring - ASEN 2000: Beta", "at least", 1]]);
const read = (...files) => readCuAesTables(XLSX, files);
const all = read(survey, faculty, courses, forcings, limits);

test("files in the standard format are left to the standard reader", () => {
    const dir = "examples/anonymized-ay26-27/";
    const standard = readdirSync(dir).filter((name) => name.endsWith(".csv")).map((name) => ({ name, bytes: readFileSync(dir + name) }));
    assert.equal(read(...standard), null);
});

test("uGrad TC is both the minimum and the maximum", () => {
    assert.deepEqual(all.tables.faculty.map((f) => [f.name, f["min tc"], f["max tc"]]), [["ADAMS, ANN", "1", "1"], ["BAKER, BOB", "2", "2"], ["CRUMB, CY", "1", "1"]]);
});

test("Min TC and Max TC columns are used when the faculty file has them", () => {
    const withRange = csv("faculty.csv", [["Name", "uGrad TC", "Min TC", "Max TC"], ["ADAMS, ANN", 1, 0, 3], ["BAKER, BOB", 2, 2, 2], ["CRUMB, CY", 1, 1, 1]]);
    const result = read(survey, withRange, courses, limits);
    assert.deepEqual([result.tables.faculty[0]["min tc"], result.tables.faculty[0]["max tc"]], ["0", "3"]);
    assert.ok(!result.warnings.some((w) => w.includes("uGrad TC")));
});

test("the latest response is used, whatever its place in the file", () => {
    const ann = all.tables.preferences.filter((p) => p.faculty === "ADAMS, ANN");
    assert.equal(ann.find((p) => p.course === "Fall - ASEN 1000: Alpha").rank, 1);
    assert.equal(all.tables.faculty[0].unavailable, "Spring");
});

test("survey answers are matched to courses despite notes and punctuation", () => {
    const ann = Object.fromEntries(all.tables.preferences.filter((p) => p.faculty === "ADAMS, ANN").map((p) => [p.course, p.rank]));
    assert.deepEqual(ann, {
        "Fall - ASEN 1000: Alpha": 1,
        "Spring - ASEN 2000: Beta": 1,        // tied with #1; not confused with the Summer course of the same number
        "Fall - ASEN 3000 Gamma": 1,          // tied with #3, which is blank, so it takes the rank of #2
        "Fall and Spring - ASEN 4018/4028: Senior Projects (Tech Support)": 5,
    });
    assert.ok(all.warnings.some((w) => w.includes("Not Listed") && w.includes("ADAMS, ANN")));
});

test("a course listed twice keeps its better rank", () => {
    assert.deepEqual(all.tables.preferences.filter((p) => p.faculty === "BAKER, BOB"), [{ faculty: "BAKER, BOB", course: "Spring - ASEN 2000: Beta", rank: 1 }]);
});

test("people and responses that do not line up are reported", () => {
    const has = (text) => all.warnings.some((w) => w.includes(text));
    assert.ok(has('"DOE, DEE" is not in the faculty list'));
    assert.ok(has("no response from CRUMB, CY"));
    assert.ok(has("BAKER, BOB is unavailable both semesters but has 2 TC"));
    assert.equal(all.tables.faculty[1].unavailable, "Fall and Spring");
});

test("forcings are matched to the course list; a missing bannings file stays missing", () => {
    assert.deepEqual(all.tables.forced.map((f) => [f.faculty, f.course]), [["CRUMB, CY", "Fall - ASEN 3000 Gamma"]]);
    assert.equal(all.tables.banned, undefined);
    assert.equal(read(survey, faculty, courses, limits).tables.forced, undefined);
});

test("the limits file is passed through, and may have no rows", () => {
    assert.equal(all.tables.limits.length, 1);
    const empty = csv("limits.csv", [["Type", "Courses", "Operator", "Limit"]]);
    assert.deepEqual(read(survey, faculty, courses, empty).tables.limits, []);
});

test("recommendations point toward the standard format", () => {
    const recommended = all.warnings.filter((w) => w.startsWith("Recommended"));
    for (const text of ['"Min TC" and "Max TC"', '"Unavailable" column', '"Semester" column', '"preferences" table', 'rename "forcings.csv" to "forced"']) {
        assert.ok(recommended.some((w) => w.includes(text)), text);
    }
});

test("a missing file is an error", () => {
    assert.throws(() => read(survey, faculty, limits), /could not find the courses file/);
    assert.throws(() => read(faculty, courses, limits), /could not find the survey file/);
    assert.throws(() => read(survey, faculty, courses, forcings), /no limits file among the files chosen/);
});

test("the converted tables solve", async () => {
    const { data, warnings } = buildData(all.tables);
    assert.deepEqual(warnings, []);
    const { rows } = solveAssignment(await loadHighs(), data, constraints, objectives);
    const teaches = (name) => rows.filter((r) => r.faculty === name).map((r) => r.course);
    assert.deepEqual(teaches("ADAMS, ANN"), ["Fall - ASEN 1000: Alpha"]);   // Ann is away in the Spring
    // Cy is forced into Gamma and is also the only one free to take Beta in the Spring.
    assert.deepEqual(teaches("CRUMB, CY").sort(), ["Fall - ASEN 3000 Gamma", "Spring - ASEN 2000: Beta"]);
});
