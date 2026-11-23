// Rules for teaching assignments: every constraint must hold; objectives are
// optimized in the order listed (loads first, then the worst choices first).
import {
    UNRANKED, CoverCourses, SemesterLoad, Unavailable, Forced, Banned, Limits, MinimizeLoadDeviation, MinimizeRank,
} from "../src/assignment.js";

export const constraints = [
    CoverCourses(),
    SemesterLoad(3),
    Unavailable(),
    Forced(),
    Banned(),
    Limits(),
];

export const objectives = [
    MinimizeLoadDeviation(),
    MinimizeRank(UNRANKED),
    MinimizeRank(8),
    MinimizeRank(7),
    MinimizeRank(6),
    MinimizeRank(5),
    MinimizeRank(4),
    MinimizeRank(3),
    MinimizeRank(2),
];
