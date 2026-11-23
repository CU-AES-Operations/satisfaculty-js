// Read the input spreadsheets and turn them into the data the model uses.
//
// Six tables, each either a tab in a workbook or a file of its own (.xlsx or .csv).
// A table is recognized by its tab name or, failing that, its file name:
//
//   faculty      Name, Min TC, Max TC, Unavailable       (Unavailable: blank, "Fall", "Spring", or "Fall and Spring")
//   courses      Course, Min TC, Max TC, TC Per Split, Max TC per Faculty, Semester
//                                                        (Semester: "Fall", "Spring", or "Fall and Spring";
//                                                         if the column is missing it is read from the course name)
//   preferences  Faculty, Course, Rank                   (1 = first choice; ties share a rank)
//   forced       Faculty, Course, Sections               (optional table)
//   banned       Faculty, Course                         (optional table)
//   limits       Type, Courses, Operator, Limit          (optional table; limits on a group of courses)
//                                                        Type "Offering": total TC offered in the group, e.g. == 1
//                                                        Type "Teaching": TC any one person teaches in the group
//                                                        Courses: names separated by ";"
//                                                        Operator: "at most", "at least", or "exactly"
//
// Column names ignore capitalization and surrounding spaces. Extra columns (e.g. Notes) are ignored.

// "preferences" comes first so that a file called faculty_preferences.csv is read as preferences.
const TABLES = ["preferences", "forced", "banned", "limits", "courses", "faculty"];
const tableNamed = (name) => TABLES.find((t) => name.toLowerCase().includes(t));

// files: [{ name, bytes }]. XLSX is the SheetJS library. Returns { tableName: [rowObject, ...] }.
export function readTables(XLSX, files) {
    const tables = {};
    for (const file of files) {
        const workbook = XLSX.read(file.bytes, { type: "array" });
        for (const sheetName of workbook.SheetNames) {
            const table = tableNamed(sheetName) ?? tableNamed(file.name);
            if (!table) continue;
            if (tables[table]) throw new Error(`Found the "${table}" table twice (second time in ${file.name})`);
            const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
            // Normalize column names: "  Min TC " -> "min tc"
            tables[table] = rows.map((row) =>
                Object.fromEntries(Object.entries(row).map(([key, value]) => [key.trim().toLowerCase(), value])));
        }
    }
    return tables;
}

// Words rather than symbols, because a spreadsheet reads a cell starting with "=" as a formula.
const OPERATORS = { "at most": "<=", "at least": ">=", "exactly": "==" };

const text = (row, column) => String(row[column] ?? "").trim();

function number(row, column, where) {
    const value = Number(row[column]);
    if (text(row, column) === "" || Number.isNaN(value)) throw new Error(`${where}: "${column}" must be a number`);
    return value;
}

// TC values typed as 0.333333 are meant as thirds; make them exact so that three of them add up to 1.
const thirds = (value) => (Math.abs(value * 3 - Math.round(value * 3)) < 1e-4 ? Math.round(value * 3) / 3 : value);

const semesters = (s) => ["Fall", "Spring"].filter((semester) => s.toLowerCase().includes(semester.toLowerCase()));

// Returns { data, warnings }. Throws on problems that make the inputs unusable.
export function buildData(tables) {
    for (const required of ["faculty", "courses", "preferences"]) {
        if (!tables[required]?.length) throw new Error(`Missing or empty table: ${required}`);
    }
    const warnings = [];

    const courses = tables.courses.filter((row) => text(row, "course")).map((row) => {
        const name = text(row, "course");
        return {
            name,
            minTC: number(row, "min tc", name),
            maxTC: number(row, "max tc", name),
            tcPerSection: thirds(number(row, "tc per split", name)),
            maxTCPerFaculty: thirds(number(row, "max tc per faculty", name)),
            semesters: semesters("semester" in row ? text(row, "semester") : name),
        };
    });

    const faculty = tables.faculty.filter((row) => text(row, "name")).map((row) => {
        const name = text(row, "name");
        return {
            name,
            minTC: number(row, "min tc", name),
            maxTC: number(row, "max tc", name),
            unavailable: semesters(text(row, "unavailable")),
            preferences: {},
        };
    });

    const courseNames = new Set(courses.map((c) => c.name));
    const facultyByName = new Map(faculty.map((f) => [f.name, f]));
    const known = (row, table) => {
        const f = text(row, "faculty"), c = text(row, "course");
        if (!f && !c) return false;  // blank row
        if (!facultyByName.has(f)) warnings.push(`${table}: unknown faculty "${f}" (row ignored)`);
        else if (!courseNames.has(c)) warnings.push(`${table}: unknown course "${c}" for ${f} (row ignored)`);
        else return true;
        return false;
    };

    for (const row of tables.preferences) {
        if (known(row, "preferences")) {
            const where = `preferences: ${text(row, "faculty")}`;
            facultyByName.get(text(row, "faculty")).preferences[text(row, "course")] = number(row, "rank", where);
        }
    }
    const forced = (tables.forced ?? []).filter((row) => known(row, "forced")).map((row) => ({
        faculty: text(row, "faculty"),
        course: text(row, "course"),
        sections: number(row, "sections", `forced: ${text(row, "faculty")}`),
    }));
    const banned = (tables.banned ?? []).filter((row) => known(row, "banned")).map((row) => ({
        faculty: text(row, "faculty"),
        course: text(row, "course"),
    }));

    const limits = (tables.limits ?? []).filter((row) => text(row, "courses")).map((row) => {
        const limit = {
            type: text(row, "type").toLowerCase(),
            courses: text(row, "courses").split(";").map((name) => name.trim()).filter((name) => name),
            operator: OPERATORS[text(row, "operator").toLowerCase()],
            limit: number(row, "limit", "limits"),
        };
        if (!["offering", "teaching"].includes(limit.type)) throw new Error(`limits: Type must be Offering or Teaching, not "${text(row, "type")}"`);
        if (!limit.operator) throw new Error(`limits: Operator must be "at most", "at least", or "exactly", not "${text(row, "operator")}"`);
        for (const name of limit.courses) if (!courseNames.has(name)) throw new Error(`limits: unknown course "${name}"`);
        return limit;
    });

    return { data: { faculty, courses, forced, banned, limits }, warnings };
}
