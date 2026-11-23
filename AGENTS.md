# Instructions for AI agents (and a quick orientation for people)

## What this is

Satisfaculty is a static web page, live at <https://satisfaculty.com>, that helps a university department
plan its teaching. Staff choose their spreadsheets, press Solve, and get a result. Everything runs in the
browser tab with the HiGHS solver compiled to WebAssembly: there is no server, no accounts, and no data
leaves the user's computer.

The planning has two steps:

1. **Teaching assignments** — which faculty teach which courses. *This is what exists today.*
2. **Course scheduling** — which room and time slot each class gets. *Not built yet.* It is currently done by
   the Python package in [CU-AES-Operations/satisfaculty](https://github.com/CU-AES-Operations/satisfaculty),
   which this project will replace. The design for the in-browser version is at
   <https://zachary.sunberg.net/schedule-optimizer/>. Both steps will live on this one site.

Both steps use **lexicographic optimization**: every constraint must hold, and the objectives are optimized
one at a time in priority order, each locked at its optimum before the next is solved. A lower-priority
objective can never make a higher one worse.

## How the code is organized

```
files -> src/inputs.js -> data -> src/assignment.js + rules/assignment.js -> src/lexmip.js -> src/solve.js -> page or CSV
```

- `src/lexmip.js` — a minimal mixed-integer-program container (`Problem`) and `lexicographicOptimize`, the
  loop that sets an objective, solves, and adds a row locking the result. It knows nothing about teaching.
  Scheduling should reuse it.
- `src/assignment.js` — the teaching-assignment model. The variables are `y[f][c]`, the number of sections
  of course `c` taught by faculty member `f`. Constraints and objectives are small objects
  (`{ name, apply(model) }` and `{ name, sense, terms(model) }`), in the style of the Python satisfaculty.
- `rules/assignment.js` — the list of constraints and the ordered list of objectives actually used.
  Faculty load comes first, then preference ranks from worst (unranked) to best.
- `src/inputs.js` — reads the standard spreadsheet tables (one workbook with a tab per table, or one file per
  table) and validates them. The table formats are documented at the top of the file.
- `src/solve.js` — builds the model, solves it, and turns the solution into rows for display and CSV.
- `index.html` — the whole web page: layout, styles, and a short script that calls the modules above.
- `run/assign.js` — the same solve from the command line.
- `cu-aes/` — CU Boulder Aerospace only: converts the files that department's staff currently keep into the
  standard tables. It is a temporary bridge and will be removed.
- `examples/anonymized-ay26-27/` — realistic example inputs with made-up names and course titles.
- `test/` and `cu-aes/inputs.test.js` — tests (`npm test`).

## Rules

**Never commit real faculty data.** Names, preferences, loads, and survey responses stay in `data/`, which
is gitignored. Anything committed as an example or test fixture must be anonymized or made up. Before
committing, check that no real names have slipped into code, tests, comments, or example files.

**Keep it simple.** The people who maintain this are engineers, not web developers, and they read the
numerical code to check that it does what they intend.

- Plain JavaScript modules. No TypeScript, no framework, no bundler, no build step: the files in the repo are
  the files the browser runs.
- `src/lexmip.js` and `src/assignment.js` must stay short and readable by someone who knows optimization
  but not JavaScript. Name things after the quantities in the formulation, and say in a comment what each
  constraint or objective means.
- Do not build features ahead of need. Make the smallest change that does what was asked, and do not add
  options, abstractions, or UI for things nobody has requested.
- Four-space indentation.

**Keep department-specific code out of the main code.** Anything that only makes sense for one department's
files or habits goes in that department's folder (`cu-aes/`), together with its tests, so that deleting the
folder removes it cleanly. The main code should work for any department that supplies the standard tables.

**Library versions in `package.json` must be exact** (no `^` or `~`). The page reads that file and loads
HiGHS and SheetJS from the jsDelivr CDN at those versions, so the live site uses exactly what the tests ran
against. Do not write a version number into `index.html`. Dependabot proposes updates.

**Test before committing.** Run `npm test`. Add a test with every change to the model or the readers: a
small hand-built case with a known answer is the preferred kind (see `test/model.test.js`).

**Pushing to `master` deploys.** GitHub Actions runs the tests and, if they pass, publishes the site to
satisfaculty.com. Treat a push to `master` as a release.

## Adding course scheduling

When scheduling is added, follow the same shape: a model file beside `src/assignment.js`, a rules file
beside `rules/assignment.js`, readers for its tables, and its own tests, all on top of the shared
`src/lexmip.js`. The scheduling model, its constraint and objective types, and the current department's
rules are in the Python repo above and in the private `aes-satisfaculty` repo; the first milestone is
reproducing the Python tool's schedule from the same inputs.
