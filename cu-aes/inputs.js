// CU Boulder Aerospace only: read the files the staff currently keep and convert them
// to the standard tables (see ../src/inputs.js, which documents the preferred format).
// Nothing outside this folder depends on the details here.
//
// The staff files, recognized by their column headings (file names do not matter):
//   Qualtrics survey export   ResponseId, Q Name, Q Sabbatical/DTL, preference and tie questions
//   faculty list              Name, uGrad TC, Grad TC, Total TC, NOTES
//   courses                   Course, Min TC, Max TC, TC Per Split, Max TC per Faculty, Notes
//   forcings                  Faculty, Course, Sections, Notes
//   bannings (optional)       Faculty, Course
//   limits                    Type, Courses, Operator, Limit   (standard format; may have no rows)

// Survey columns holding preference #1..#8, and the "equally happy with #k and #k+1" boxes.
const PREFERENCE_COLUMNS = ["q1 _1", "q2_1", "q3_1", "q4_1", "q5_1", "q73_1", "q81_1", "q82_1"];
const TIE_COLUMNS = ["q12", "q23", "q34", "q45", "q31", "q84", "q32"];  // TIE_COLUMNS[k-1] ties #k and #k+1

const text = (value) => String(value ?? "").trim();

// The first sheet: { columns, rows }, with column names lower-cased and trimmed ("Q34 " -> "q34").
function sheetOf(XLSX, file) {
    // Decode csv as UTF-8 ourselves so that accented names survive.
    const isCsv = file.name.toLowerCase().endsWith(".csv");
    const workbook = isCsv
        ? XLSX.read(new TextDecoder().decode(file.bytes), { type: "string", raw: true })
        : XLSX.read(file.bytes, { type: "array" });
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const clean = (name) => String(name).trim().toLowerCase();
    const columns = (XLSX.utils.sheet_to_json(sheet, { header: 1 })[0] ?? []).map(clean);  // known even when there are no rows
    const rows = XLSX.utils.sheet_to_json(sheet, { defval: "" })
        .map((row) => Object.fromEntries(Object.entries(row).map(([key, value]) => [clean(key), value])));
    return { columns, rows };
}

// "11/19/2026 07:05" -> a number that sorts by time.
function time(value) {
    const m = /(\d+)\/(\d+)\/(\d+)\s+(\d+):(\d+)/.exec(text(value));
    return m ? new Date(m[3], m[1] - 1, m[2], m[4], m[5]).getTime() : 0;
}

// "Fall - ASEN 2401: Statics (180 cap; 2 sections)" -> "fall|2401"
function courseKey(name) {
    const semester = /^\s*(fall and spring|fall|spring|summer)/i.exec(name)?.[1].toLowerCase() ?? "";
    return semester + "|" + (name.match(/\d{4}/g) ?? []).join("/");
}

// The survey and the forcings name courses slightly differently from the course list
// (extra notes in parentheses, punctuation). Match on semester and course number; when
// several courses share those (the Senior Projects roles), take the one whose name the
// answer starts with.
function courseMatcher(courseNames) {
    const exact = new Set(courseNames);
    return (answer) => {
        if (exact.has(answer)) return answer;
        const candidates = courseNames.filter((name) => courseKey(name) === courseKey(answer));
        if (candidates.length === 1) return candidates[0];
        const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
        return candidates.find((name) => squash(answer).startsWith(squash(name))) ?? null;
    };
}

// files: [{ name, bytes }]. Returns null if these are not the CU AES staff files,
// otherwise { tables, warnings } with tables in the standard format.
export function readCuAesTables(XLSX, files) {
    const found = {};
    const fileOf = {};  // which file each table came from
    for (const file of files) {
        const { columns, rows } = sheetOf(XLSX, file);
        const has = (...needed) => needed.every((column) => columns.includes(column));
        let table = null;
        if (has("responseid", "q name")) table = "survey";
        else if (has("name", "ugrad tc")) table = "faculty";
        else if (has("course", "tc per split")) table = "courses";
        else if (has("faculty", "course", "sections")) table = "forced";
        else if (has("faculty", "course")) table = "banned";
        else if (has("type", "courses", "operator", "limit")) table = "limits";
        if (!table) continue;
        found[table] = table === "survey" ? rows.slice(2) : rows;  // the survey has two extra heading rows
        fileOf[table] = file.name;
    }
    if (!found.survey && !found.faculty) return null;
    for (const needed of ["survey", "faculty", "courses"]) {
        if (!found[needed]) throw new Error(`CU AES files: could not find the ${needed} file among the files chosen`);
    }
    if (!found.limits) {
        throw new Error("CU AES files: no limits file among the files chosen. Add a file with the columns Type, Courses, " +
            'Operator, Limit for rules such as "taught exactly once per year" (it may have no rows).');
    }
    const warnings = [];

    // Faculty: the undergraduate TC is both the minimum and the maximum, unless those columns exist.
    const hasMinMax = "min tc" in found.faculty[0] && "max tc" in found.faculty[0];
    const faculty = found.faculty.filter((row) => text(row.name)).map((row) => ({
        name: text(row.name),
        "min tc": hasMinMax ? row["min tc"] : row["ugrad tc"],
        "max tc": hasMinMax ? row["max tc"] : row["ugrad tc"],
        unavailable: "",
    }));
    const facultyByName = new Map(faculty.map((person) => [person.name, person]));

    const courseNames = found.courses.map((row) => text(row.course)).filter((name) => name);
    const matchCourse = courseMatcher(courseNames);

    // Survey: keep each person's most recent response.
    const latest = new Map();
    for (const response of found.survey) {
        const name = text(response["q name"]);
        if (!name) continue;
        if (!facultyByName.has(name)) {
            if (!latest.has(name)) warnings.push(`survey: "${name}" is not in the faculty list (response ignored)`);
            latest.set(name, null);
        } else if (!latest.get(name) || time(response.recordeddate) >= time(latest.get(name).recordeddate)) {
            latest.set(name, response);
        }
    }

    const preferences = [];
    for (const person of faculty) {
        const response = latest.get(person.name);
        if (!response) {
            warnings.push(`survey: no response from ${person.name} (every course counts as unranked)`);
            continue;
        }
        person.unavailable = ["Fall", "Spring"].filter((s) => text(response["q sabbatical/dtl"]).includes(s)).join(" and ");
        if (person.unavailable === "Fall and Spring" && Number(person["min tc"]) > 0) {
            warnings.push(`${person.name} is unavailable both semesters but has ${person["min tc"]} TC in the faculty list`);
        }

        // rank[k] is the rank given to preference #(k+1). A tie box gives #(k+1) the
        // rank of the nearest answered preference above it.
        const answers = PREFERENCE_COLUMNS.map((column) => text(response[column]));
        const rank = answers.map((_, k) => k + 1);
        for (let k = 1; k < answers.length; k++) {
            if (!text(response[TIE_COLUMNS[k - 1]]) || !answers[k]) continue;
            let above = k - 1;
            while (above >= 0 && !answers[above]) above--;
            if (above >= 0) rank[k] = rank[above];
        }
        const ranked = new Set();
        answers.forEach((answer, k) => {
            if (!answer) return;
            const course = matchCourse(answer);
            if (!course) warnings.push(`survey: ${person.name} chose "${answer}", which is not in the course list (ignored)`);
            else if (!ranked.has(course)) {  // a course listed twice keeps its better rank
                ranked.add(course);
                preferences.push({ faculty: person.name, course, rank: rank[k] });
            }
        });
    }

    // A table that was not provided stays undefined, so the page shows it as missing.
    const withCourse = (rows) => rows?.map((row) => ({ ...row, course: matchCourse(text(row.course)) ?? text(row.course) }));
    // Recommendations for moving toward the standard format (see ../src/inputs.js).
    const recommend = (message) => warnings.push("Recommended: " + message);
    const named = (table, word) => fileOf[table] && fileOf[table].toLowerCase().includes(word);
    if (!named("faculty", "faculty")) recommend(`name the faculty file or tab "faculty" (now "${fileOf.faculty}")`);
    if (!hasMinMax) recommend('add "Min TC" and "Max TC" columns to the faculty table; for now "uGrad TC" is used for both');
    recommend('add an "Unavailable" column to the faculty table (blank, "Fall", "Spring", or "Fall and Spring"); for now it is read from the survey');
    if (!("semester" in found.courses[0])) recommend('add a "Semester" column to the courses table; for now the semester is read from the start of each course name');
    recommend('provide a "preferences" table with columns Faculty, Course, Rank; for now ranks are worked out from the raw survey export, keeping each person\'s latest response');
    if (found.forced && !named("forced", "forced")) recommend(`rename "${fileOf.forced}" to "forced"`);
    if (found.banned && !named("banned", "banned")) recommend(`rename "${fileOf.banned}" to "banned"`);
    recommend("keep all of these as tabs in one workbook");

    return {
        tables: { faculty, courses: found.courses, preferences, forced: withCourse(found.forced), banned: withCourse(found.banned), limits: found.limits },
        warnings,
    };
}
