// Build the teaching-assignment model, solve it, and turn the solution into a table.
// Used by both the Node run script and the web page.
import { lexicographicOptimize } from "./lexmip.js";
import { AssignmentModel, UNRANKED } from "./assignment.js";

// Returns { stages: [{ name, value, seconds }],
//           rows: [{ course, faculty, sections, tc, rank }],        one per assignment; a course nobody
//                                                                   teaches gets one row with no faculty
//           loads: [{ faculty, tc, minTC, maxTC }] }                one per person
export function solveAssignment(highs, data, constraints, objectives, log = () => {}) {
    const model = new AssignmentModel(data);
    for (const constraint of constraints) constraint.apply(model);
    const stagesToSolve = objectives.map((o) => ({ name: o.name, sense: o.sense, terms: o.terms(model) }));
    const { x, stages } = lexicographicOptimize(highs, model.problem, stagesToSolve, log);

    const rows = [];
    data.courses.forEach((course, c) => {
        const before = rows.length;
        data.faculty.forEach((person, f) => {
            const sections = x[model.y[f][c]];
            if (sections > 0) {
                const rank = model.rank(f, c);
                rows.push({
                    course: course.name,
                    faculty: person.name,
                    sections,
                    tc: sections * course.tcPerSection,
                    rank: rank === UNRANKED ? "unranked" : rank,
                });
            }
        });
        if (rows.length === before) rows.push({ course: course.name, faculty: "", sections: 0, tc: 0, rank: "" });
    });
    const loads = data.faculty.map((person) => ({
        faculty: person.name,
        tc: rows.filter((row) => row.faculty === person.name).reduce((sum, row) => sum + row.tc, 0),
        minTC: person.minTC,
        maxTC: person.maxTC,
    }));
    return { stages, rows, loads };
}

// Total TC at each preference rank: { 1: 44.5, 2: 9.5, ... }
export function tcByRank(rows) {
    const totals = {};
    for (const row of rows) if (row.sections > 0) totals[row.rank] = (totals[row.rank] ?? 0) + row.tc;
    return totals;
}

// The people whose load is outside their range, with how far: [{ faculty, tc, minTC, maxTC, difference }]
export function loadDifferences(loads) {
    return loads
        .map((l) => ({ ...l, difference: l.tc > l.maxTC ? l.tc - l.maxTC : l.tc < l.minTC ? l.tc - l.minTC : 0 }))
        .filter((l) => Math.abs(l.difference) > 1e-6);
}

export function toCSV(rows) {
    const lines = ["Course,Faculty,Sections,TC,Rank"];
    for (const r of rows) lines.push(`"${r.course}","${r.faculty}",${r.sections},${r.tc.toFixed(2)},${r.rank}`);
    return lines.join("\n") + "\n";
}
