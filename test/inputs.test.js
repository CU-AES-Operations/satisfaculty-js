// Reading the standard input tables.   Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { readTables, buildData } from "../src/inputs.js";

const XLSX = createRequire(import.meta.url)("xlsx");
const csvFile = (name, text) => ({ name, bytes: Buffer.from(text) });

// Rows as readTables returns them: column names lower-cased.
const tables = (more = {}) => ({
    faculty: [{ name: "Ann", "min tc": 1, "max tc": 2, unavailable: "Fall and Spring" }, { name: "Bob", "min tc": 0, "max tc": 0, unavailable: "" }],
    courses: [
        { course: "Fall A", "min tc": 1, "max tc": 1, "tc per split": 0.333333, "max tc per faculty": 0.333333333, semester: "Fall" },
        { course: "Spring B", "min tc": 0, "max tc": 1, "tc per split": 1, "max tc per faculty": 1, semester: "spring" },
    ],
    preferences: [{ faculty: "Ann", course: "Fall A", rank: 2 }],
    ...more,
});

test("tables become model data", () => {
    const { data, warnings } = buildData(tables());
    assert.deepEqual(warnings, []);
    assert.deepEqual(data.faculty[0], { name: "Ann", minTC: 1, maxTC: 2, unavailable: ["Fall", "Spring"], preferences: { "Fall A": 2 } });
    assert.deepEqual(data.courses[1].semesters, ["Spring"]);
    assert.deepEqual([data.forced, data.banned, data.limits], [[], [], []]);
});

test("TC typed as 0.333333 is read as exactly one third", () => {
    const { data } = buildData(tables());
    assert.equal(data.courses[0].tcPerSection, 1 / 3);
    assert.equal(data.courses[0].maxTCPerFaculty, 1 / 3);
});

test("without a Semester column the semester comes from the course name", () => {
    const t = tables();
    t.courses = [{ course: "Fall and Spring - Year Long", "min tc": 1, "max tc": 1, "tc per split": 1, "max tc per faculty": 1 }];
    t.preferences = [{ faculty: "Ann", course: "Fall and Spring - Year Long", rank: 1 }];
    assert.deepEqual(buildData(t).data.courses[0].semesters, ["Fall", "Spring"]);
});

test("rows naming an unknown person or course are ignored with a warning", () => {
    const { data, warnings } = buildData(tables({
        preferences: [{ faculty: "Ann", course: "Fall Z", rank: 1 }, { faculty: "Zed", course: "Fall A", rank: 1 }],
        forced: [{ faculty: "Ann", course: "Fall Z", sections: 1 }, { faculty: "Ann", course: "Fall A", sections: 2 }],
        banned: [{ faculty: "Zed", course: "Fall A" }],
    }));
    assert.equal(warnings.length, 4);
    assert.deepEqual(data.faculty[0].preferences, {});
    assert.deepEqual(data.forced, [{ faculty: "Ann", course: "Fall A", sections: 2 }]);
    assert.deepEqual(data.banned, []);
});

test("limits use words for the operator", () => {
    const { data } = buildData(tables({ limits: [{ type: "Offering", courses: "Fall A; Spring B", operator: "At most", limit: 1 }] }));
    assert.deepEqual(data.limits, [{ type: "offering", courses: ["Fall A", "Spring B"], operator: "<=", limit: 1 }]);
});

test("problems that make the inputs unusable are errors", () => {
    assert.throws(() => buildData({ faculty: tables().faculty, courses: tables().courses }), /Missing or empty table: preferences/);
    assert.throws(() => buildData(tables({ limits: [{ type: "Offering", courses: "Fall A", operator: "<", limit: 1 }] })), /Operator must be/);
    assert.throws(() => buildData(tables({ limits: [{ type: "Other", courses: "Fall A", operator: "exactly", limit: 1 }] })), /Type must be/);
    assert.throws(() => buildData(tables({ limits: [{ type: "Offering", courses: "Fall Z", operator: "exactly", limit: 1 }] })), /unknown course "Fall Z"/);
    const t = tables();
    t.faculty[0]["min tc"] = "lots";
    assert.throws(() => buildData(t), /Ann: "min tc" must be a number/);
});

test("a table is recognized by its file name, ignoring capitals and extra columns", () => {
    const read = readTables(XLSX, [
        csvFile("Faculty.csv", "Name , MIN TC,Max TC,Notes\nAnn,1,2,hello\n"),
        csvFile("faculty_preferences.csv", "Faculty,Course,Rank\nAnn,Fall A,1\n"),
        csvFile("something else.csv", "x,y\n1,2\n"),
    ]);
    assert.deepEqual(Object.keys(read).sort(), ["faculty", "preferences"]);
    assert.deepEqual(read.faculty, [{ name: "Ann", "min tc": 1, "max tc": 2, notes: "hello" }]);
});

test("the same table twice is an error", () => {
    assert.throws(() => readTables(XLSX, [csvFile("courses.csv", "Course\nA\n"), csvFile("courses 2.csv", "Course\nB\n")]), /"courses" table twice/);
});
