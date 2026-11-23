// Teaching assignment: which faculty teach how many sections of which courses.
//
// Decision variables: y[f][c] = number of sections of course c taught by faculty f
// (an integer). One section of course c is worth c.tcPerSection teaching credits (TC).
//
// Input data (built from the spreadsheets by inputs.js):
//   faculty: [{ name, minTC, maxTC, unavailable: ["Fall"], preferences: { courseName: rank } }]
//   courses: [{ name, minTC, maxTC, tcPerSection, maxTCPerFaculty, semesters: ["Fall", "Spring"] }]
//   forced:  [{ faculty, course, sections }]
//   banned:  [{ faculty, course }]
//   limits:  [{ type: "offering" | "teaching", courses: [name], operator, limit }]
//
// Constraints and objectives are small objects, as in satisfaculty:
//   constraint: { name, apply(model) }      adds rows or tightens variable bounds
//   objective:  { name, sense, terms(model) }  returns a linear expression

import { Problem } from "./lexmip.js";

export const UNRANKED = 9;  // rank given to a course the faculty member did not list
const EPS = 1e-4;           // TC values such as 0.333333 are rounded in the data

export class AssignmentModel {
    constructor(data) {
        this.data = data;
        this.problem = new Problem();
        this.facultyIndex = new Map(data.faculty.map((f, i) => [f.name, i]));
        this.courseIndex = new Map(data.courses.map((c, i) => [c.name, i]));
        this.y = data.faculty.map((f) => data.courses.map((c) => {
            const maxSections = Math.round(c.maxTC / c.tcPerSection);
            const maxForOnePerson = Math.floor(c.maxTCPerFaculty / c.tcPerSection + EPS);
            return this.problem.addInteger(`${f.name} | ${c.name}`, 0, Math.min(maxSections, maxForOnePerson));
        }));
    }

    faculty(name) {
        if (!this.facultyIndex.has(name)) throw new Error(`Unknown faculty: ${name}`);
        return this.facultyIndex.get(name);
    }

    course(name) {
        if (!this.courseIndex.has(name)) throw new Error(`Unknown course: ${name}`);
        return this.courseIndex.get(name);
    }

    // TC taught by faculty f in the listed courses (default: all), as a linear expression.
    tc(f, courseIndices = this.data.courses.keys()) {
        return Array.from(courseIndices, (c) => [this.y[f][c], this.data.courses[c].tcPerSection]);
    }

    rank(f, c) {
        return this.data.faculty[f].preferences[this.data.courses[c].name] ?? UNRANKED;
    }
}

// ---------- Constraints ----------

// Each course gets between its minimum and maximum number of sections.
export const CoverCourses = () => ({
    name: "Cover courses",
    apply(m) {
        m.data.courses.forEach((course, c) => {
            const sections = m.data.faculty.map((_, f) => [m.y[f][c], 1]);
            m.problem.addConstraint(`Sections of ${course.name}`, sections,
                Math.round(course.minTC / course.tcPerSection), Math.round(course.maxTC / course.tcPerSection));
        });
    },
});

// Nobody teaches more than maxTC in one semester. A year-long course counts half in each.
export const SemesterLoad = (maxTC = 3) => ({
    name: "Semester load",
    apply(m) {
        for (const semester of ["Fall", "Spring"]) {
            m.data.faculty.forEach((person, f) => {
                const terms = [];
                m.data.courses.forEach((course, c) => {
                    if (course.semesters.includes(semester)) {
                        terms.push([m.y[f][c], course.tcPerSection / course.semesters.length]);
                    }
                });
                m.problem.addConstraint(`${semester} load of ${person.name}`, terms, -Infinity, maxTC);
            });
        }
    },
});

// People who are away for a semester (e.g. sabbatical) teach nothing that touches it.
export const Unavailable = () => ({
    name: "Unavailable semesters",
    apply(m) {
        m.data.faculty.forEach((person, f) => {
            m.data.courses.forEach((course, c) => {
                if (course.semesters.some((s) => person.unavailable.includes(s))) m.problem.vars[m.y[f][c]].hi = 0;
            });
        });
    },
});

// Forced assignments: this person teaches at least this many sections of this course.
// A forced course is counted as that person's first choice, whatever they ranked it.
export const Forced = () => ({
    name: "Forced assignments",
    apply(m) {
        for (const { faculty, course, sections } of m.data.forced) {
            const f = m.faculty(faculty);
            m.problem.vars[m.y[f][m.course(course)]].lo = sections;
            m.data.faculty[f].preferences[course] = 1;
        }
    },
});

// Banned assignments: this person does not teach this course.
export const Banned = () => ({
    name: "Banned assignments",
    apply(m) {
        for (const { faculty, course } of m.data.banned) {
            m.problem.vars[m.y[m.faculty(faculty)][m.course(course)]].hi = 0;
        }
    },
});

const bounds = (operator, limit) => ({
    "<=": [-Infinity, limit + EPS],
    ">=": [limit - EPS, Infinity],
    "==": [limit - EPS, limit + EPS],
})[operator];

// Total TC offered across a group of courses, e.g. "taught exactly once per year".
export const OfferingLimit = (courses, operator, limit) => ({
    name: `Offer ${operator} ${limit} TC of ${courses.join(", ")}`,
    apply(m) {
        const cs = courses.map((name) => m.course(name));
        const terms = m.data.faculty.flatMap((_, f) => m.tc(f, cs));
        m.problem.addConstraint(this.name, terms, ...bounds(operator, limit));
    },
});

// TC that any one person teaches across a group of courses.
export const TeachingLimit = (courses, operator, limit) => ({
    name: `Each person teaches ${operator} ${limit} TC of ${courses.join(", ")}`,
    apply(m) {
        const cs = courses.map((name) => m.course(name));
        m.data.faculty.forEach((person, f) => {
            m.problem.addConstraint(`${this.name}: ${person.name}`, m.tc(f, cs), ...bounds(operator, limit));
        });
    },
});

// The limits listed in the input spreadsheet.
export const Limits = () => ({
    name: "Limits on groups of courses",
    apply(m) {
        for (const { type, courses, operator, limit } of m.data.limits) {
            (type === "offering" ? OfferingLimit : TeachingLimit)(courses, operator, limit).apply(m);
        }
    },
});

// ---------- Objectives ----------

// Minimize the total TC by which people are over their maximum or under their minimum.
// For each person:  minTC <= (TC taught) - over + under <= maxTC,  with over, under >= 0.
export const MinimizeLoadDeviation = () => ({
    name: "TC over or under each person's load",
    sense: "minimize",
    terms(m) {
        const terms = [];
        m.data.faculty.forEach((person, f) => {
            const over = m.problem.addContinuous(`over | ${person.name}`, 0, Infinity);
            const under = m.problem.addContinuous(`under | ${person.name}`, 0, Infinity);
            m.problem.addConstraint(`Load of ${person.name}`, [...m.tc(f), [over, -1], [under, 1]], person.minTC, person.maxTC);
            terms.push([over, 1], [under, 1]);
        });
        return terms;
    },
});

// Minimize the TC assigned at preference rank `rank`.
export const MinimizeRank = (rank) => ({
    name: rank === UNRANKED ? "TC in unranked courses" : `TC in choice #${rank}`,
    sense: "minimize",
    terms(m) {
        const terms = [];
        m.data.faculty.forEach((_, f) => {
            m.data.courses.forEach((course, c) => {
                if (m.rank(f, c) === rank) terms.push([m.y[f][c], course.tcPerSection]);
            });
        });
        return terms;
    },
});
