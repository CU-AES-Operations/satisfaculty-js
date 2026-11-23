# satisfaculty-js

In-browser optimizer for (1) teaching assignments and (2) course scheduling, using HiGHS compiled to
WebAssembly. So far: teaching assignments, from the command line or a bare web page.

- `src/lexmip.js` — integer-program container and the lexicographic solve loop.
- `src/inputs.js` — reads the input spreadsheets (format documented at the top of the file).
- `src/assignment.js` — teaching-assignment variables, constraints, and objectives.
- `rules/assignment.js` — the constraints and objectives, in order.
- `src/solve.js` — builds the model, solves, and tabulates the result.
- `run/assign.js` — command-line run.
- `examples/anonymized-ay26-27/` — realistic example inputs with made-up names and course titles.
- `test/` — solves the example and checks the result.
- `cu-aes/` — CU Boulder Aerospace only: converts the files the staff currently keep into the standard tables.
- `index.html` — the web page: choose the input spreadsheets, press Solve.

```bash
npm install
npm test
node run/assign.js examples/anonymized-ay26-27/anonymized-ay26-27.xlsx
```

Real faculty data must never be committed. Keep it in `data/`, which is gitignored.

## Deployment and library versions

Every push runs the tests (GitHub Actions); a push to `master` that passes is published with GitHub Pages.
The page loads HiGHS and SheetJS from the jsDelivr CDN at the exact versions in `package.json`, the same
ones the tests use. Dependabot opens a pull request when a new version appears; merging it updates the site.
