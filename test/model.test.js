// Small hand-built cases with known answers, one per rule.   Run with: npm test
import test from "node:test";
import assert from "node:assert/strict";
import loadHighs from "highs";
import { solveAssignment, tcByRank, loadDifferences, toCSV } from "../src/solve.js";
import { constraints, objectives } from "../rules/assignment.js";

const highs = await loadHighs();

// A person who must teach exactly `tc`; a 1-TC-per-section course that needs exactly `tc`.
const person = (name, tc, more = {}) => ({ name, minTC: tc, maxTC: tc, unavailable: [], preferences: {}, ...more });
const course = (name, tc, more = {}) => ({
    name, minTC: tc, maxTC: tc, tcPerSection: 1, maxTCPerFaculty: tc,
    semesters: ["Fall", "Spring"].filter((s) => name.includes(s)), ...more,
});

function solve({ faculty, courses, forced = [], banned = [], limits = [] }) {
    const result = solveAssignment(highs, { faculty, courses, forced, banned, limits }, constraints, objectives);
    return {
        ...result,
        value: (goal) => Math.round(result.stages.find((s) => s.name === goal).value * 1000) / 1000 + 0,  // + 0 turns -0 into 0
        teaches: (name) => result.rows.filter((r) => r.faculty === name).map((r) => r.course).sort(),
    };
}
const LOAD = "TC over or under each person's load";
const UNRANKED = "TC in unranked courses";

test("everyone gets their first choice when that is possible", () => {
    const r = solve({
        faculty: [person("Ann", 1, { preferences: { "Fall A": 1, "Fall B": 2 } }), person("Bob", 1, { preferences: { "Fall B": 1, "Fall A": 2 } })],
        courses: [course("Fall A", 1), course("Fall B", 1)],
    });
    assert.deepEqual(r.teaches("Ann"), ["Fall A"]);
    assert.deepEqual(r.teaches("Bob"), ["Fall B"]);
    assert.deepEqual(tcByRank(r.rows), { 1: 2 });
    assert.equal(r.value(LOAD), 0);
});

test("the worst ranks are minimized first", () => {
    // Ann first-choice A leaves Bob with an unranked course; avoiding that costs Ann a 3rd choice.
    const r = solve({
        faculty: [person("Ann", 1, { preferences: { "Fall A": 1, "Fall B": 3 } }), person("Bob", 1, { preferences: { "Fall A": 1 } })],
        courses: [course("Fall A", 1), course("Fall B", 1)],
    });
    assert.deepEqual(r.teaches("Ann"), ["Fall B"]);
    assert.deepEqual(r.teaches("Bob"), ["Fall A"]);
    assert.equal(r.value(UNRANKED), 0);
    assert.equal(r.value("TC in choice #3"), 1);
});

test("a forced assignment is made and counts as a first choice", () => {
    const r = solve({
        faculty: [person("Ann", 1, { preferences: { "Fall A": 1, "Fall B": 3 } }), person("Bob", 1, { preferences: { "Fall A": 1 } })],
        courses: [course("Fall A", 1), course("Fall B", 1)],
        forced: [{ faculty: "Ann", course: "Fall B", sections: 1 }],
    });
    assert.deepEqual(r.teaches("Ann"), ["Fall B"]);
    assert.deepEqual(tcByRank(r.rows), { 1: 2 });
});

test("a banned assignment is not made", () => {
    const r = solve({
        faculty: [person("Ann", 1, { preferences: { "Fall A": 1, "Fall B": 3 } }), person("Bob", 1, { preferences: { "Fall A": 1 } })],
        courses: [course("Fall A", 1), course("Fall B", 1)],
        banned: [{ faculty: "Ann", course: "Fall B" }],
    });
    assert.deepEqual(r.teaches("Ann"), ["Fall A"]);
    assert.equal(r.value(UNRANKED), 1);
});

test("a person does not teach in a semester they are unavailable", () => {
    const r = solve({
        faculty: [person("Ann", 1, { unavailable: ["Fall"], preferences: { "Fall A": 1 } }), person("Bob", 1)],
        courses: [course("Fall A", 1), course("Spring B", 1)],
    });
    assert.deepEqual(r.teaches("Ann"), ["Spring B"]);
});

test("a year-long course is off limits to someone unavailable for either semester", () => {
    const r = solve({
        faculty: [person("Ann", 1, { unavailable: ["Spring"] }), person("Bob", 1)],
        courses: [course("Fall and Spring Y", 1), course("Fall A", 1)],
    });
    assert.deepEqual(r.teaches("Ann"), ["Fall A"]);
});

test("nobody teaches more than 3 TC in a semester", () => {
    // Ann's load is 4, all of it in the Fall: she can take only 3, so Bob (load 0) takes 1.
    const r = solve({
        faculty: [person("Ann", 4), person("Bob", 0)],
        courses: [course("Fall A", 4)],
    });
    assert.equal(r.loads.find((l) => l.faculty === "Ann").tc, 3);
    assert.equal(r.value(LOAD), 2);  // Ann 1 under, Bob 1 over
});

test("a year-long course counts half toward each semester", () => {
    // 4 TC of year-long teaching is 2 per semester, within the cap of 3.
    const r = solve({ faculty: [person("Ann", 4), person("Bob", 0)], courses: [course("Fall and Spring Y", 4)] });
    assert.equal(r.value(LOAD), 0);
});

test("load is the first goal: an overload is reported, not infeasible", () => {
    const r = solve({ faculty: [person("Ann", 1)], courses: [course("Fall A", 1), course("Spring B", 1)] });
    assert.equal(r.value(LOAD), 1);
    const [difference] = loadDifferences(r.loads);
    assert.deepEqual([difference.faculty, difference.tc, difference.difference], ["Ann", 2, 1]);
});

test("a load range is respected without counting as a deviation", () => {
    const r = solve({ faculty: [person("Ann", 0, { minTC: 1, maxTC: 3 })], courses: [course("Fall A", 1), course("Spring B", 1)] });
    assert.equal(r.value(LOAD), 0);
    assert.deepEqual(loadDifferences(r.loads), []);
});

test("an optional course is left untaught and listed with no faculty", () => {
    const r = solve({ faculty: [person("Ann", 1)], courses: [course("Fall A", 1), course("Fall Optional", 1, { minTC: 0 })] });
    assert.deepEqual(r.rows.find((row) => row.course === "Fall Optional"), { course: "Fall Optional", faculty: "", sections: 0, tc: 0, rank: "" });
    assert.deepEqual(tcByRank(r.rows), { unranked: 1 });
    assert.match(toCSV(r.rows), /"Fall Optional","",0,0\.00,\n/);
});

test("an offering limit makes exactly one of two optional courses run", () => {
    const optional = { minTC: 0 };
    const r = solve({
        faculty: [person("Ann", 0)],
        courses: [course("Fall X", 1, optional), course("Spring X", 1, optional)],
        limits: [{ type: "offering", courses: ["Fall X", "Spring X"], operator: "==", limit: 1 }],
    });
    assert.equal(r.rows.filter((row) => row.sections > 0).length, 1);
    assert.equal(r.value(LOAD), 1);  // without the limit nothing would be taught
});

test("a teaching limit caps what one person teaches across a group", () => {
    // Ann could cover both, but may teach at most 1 TC of the group, so Bob (load 0) takes one.
    const r = solve({
        faculty: [person("Ann", 2), person("Bob", 0)],
        courses: [course("Fall S", 1), course("Spring S", 1)],
        limits: [{ type: "teaching", courses: ["Fall S", "Spring S"], operator: "<=", limit: 1 }],
    });
    assert.equal(r.teaches("Ann").length, 1);
    assert.equal(r.teaches("Bob").length, 1);
    assert.equal(r.value(LOAD), 2);
});

test("a course is split into sections, with a cap on what one person takes", () => {
    // 3 sections of 1 TC; nobody may take more than 2 TC of it.
    const r = solve({ faculty: [person("Ann", 3), person("Bob", 0)], courses: [course("Fall A", 3, { maxTCPerFaculty: 2 })] });
    assert.equal(r.rows.find((row) => row.faculty === "Ann").sections, 2);
    assert.equal(r.rows.find((row) => row.faculty === "Bob").sections, 1);
});

test("three sections of one third of a TC make exactly one TC", () => {
    const r = solve({ faculty: [person("Ann", 1)], courses: [course("Fall Seminar", 1, { tcPerSection: 1 / 3, maxTCPerFaculty: 1 })] });
    assert.equal(r.rows[0].sections, 3);
    assert.equal(r.value(LOAD), 0);
    assert.deepEqual(loadDifferences(r.loads), []);
});
