// A minimal mixed-integer-program container and a lexicographic solver on top of HiGHS.
//
// A linear expression is an array of [variableIndex, coefficient] pairs,
// with each variable appearing at most once.

export class Problem {
    constructor() {
        this.vars = [];  // { name, lo, hi, integer }   lo <= v <= hi
        this.rows = [];  // { name, terms, lo, hi }   lo <= sum(coef * v) <= hi
    }

    addInteger(name, lo, hi) {
        this.vars.push({ name, lo, hi, integer: true });
        return this.vars.length - 1;
    }

    addContinuous(name, lo, hi) {
        this.vars.push({ name, lo, hi, integer: false });
        return this.vars.length - 1;
    }

    addConstraint(name, terms, lo, hi) {
        this.rows.push({ name, terms, lo, hi });
    }
}

const split = (terms) => ({ indices: terms.map((t) => t[0]), values: terms.map((t) => t[1]) });

// Optimize the objectives one at a time, in order. After each solve, a row is
// added that holds that objective at its optimum (within `tolerance`, a
// fraction), so later objectives can never make an earlier one worse.
//
// objectives: [{ name, sense: "minimize" | "maximize", terms, tolerance? }]
// Returns { x, stages: [{ name, value, seconds }] }, or throws if a stage is not optimal.
export function lexicographicOptimize(highs, problem, objectives, log = () => {}) {
    const n = problem.vars.length;
    const model = highs.createModel();
    try {
        model.options.set({ output_flag: false });
        model.addVars(problem.vars.map((v) => v.lo), problem.vars.map((v) => v.hi));
        const allVars = { kind: "range", from: 0, to: n - 1 };
        const { integer, continuous } = highs.constants.variableType;
        model.changeColsIntegrality(allVars, Int32Array.from(problem.vars, (v) => (v.integer ? integer : continuous)));
        for (const row of problem.rows) model.addRow(row.lo, row.hi, split(row.terms));

        const stages = [];
        let x = null;
        for (const objective of objectives) {
            const minimize = objective.sense !== "maximize";
            const cost = new Float64Array(n);
            for (const [j, c] of objective.terms) cost[j] = c;
            model.changeColsCost(allVars, cost);
            model.changeObjectiveSense(minimize ? highs.constants.objectiveSense.minimize : highs.constants.objectiveSense.maximize);

            const start = performance.now();
            model.run();
            const seconds = (performance.now() - start) / 1000;
            if (model.getModelStatus() !== highs.constants.modelStatus.optimal) {
                throw new Error(`"${objective.name}": solver status ${model.getModelStatus()} (7 = optimal, 8 = infeasible)`);
            }
            x = Array.from(model.getSolution().colValue, (value, j) => (problem.vars[j].integer ? Math.round(value) : value));
            const value = model.getObjectiveValue();
            stages.push({ name: objective.name, value, seconds });
            log(`${objective.name}: ${value.toFixed(3)}  (${seconds.toFixed(2)} s)`);

            // Lock this objective before moving on.
            if (objective.terms.length > 0) {
                const slack = Math.abs(value) * (objective.tolerance ?? 0) + 1e-6;
                if (minimize) model.addRow(-Infinity, value + slack, split(objective.terms));
                else model.addRow(value - slack, Infinity, split(objective.terms));
            }
        }
        return { x, stages };
    } finally {
        model.dispose();
    }
}
