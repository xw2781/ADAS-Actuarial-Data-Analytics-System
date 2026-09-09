import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

// The DFM method payload carries the ratio triangle and the exclusion pattern as
// two matrices that a strict contract requires to have identical row lengths
// (`DFM exclusion rows must match the corresponding ratio-value rows`). They are
// produced by two builders that live in different modules, so this suite runs
// both against one model and compares the shapes they emit.

const root = new URL("../", import.meta.url);
const source = async (path) => readFile(new URL(path, root), "utf8");

const [persistenceSource, summarySource, stateSource, ratiosTabSource] = await Promise.all([
  source("ui/method_pages/dfm/dfm_persistence.js"),
  source("ui/method_pages/dfm/ratios_summary/summary_model.js"),
  source("ui/method_pages/dfm/dfm_state.js"),
  source("ui/method_pages/dfm/dfm_ratios_tab.js"),
]);
const { calcRatio, ratioNumberOrNull, roundRatio } = await import(
  new URL("ui/method_pages/dfm/dfm_ratio_calc.js", root)
);

function functionSlice(text, startMarker, endMarker) {
  const start = text.indexOf(startMarker);
  const end = text.indexOf(endMarker, start + startMarker.length);
  assert.notEqual(start, -1, `missing ${startMarker}`);
  assert.notEqual(end, -1, `missing ${endMarker}`);
  return text.slice(start, end).replace(/^export /gmu, "");
}

const DFM_ANALYSIS_DECIMALS = Number(
  /const DFM_ANALYSIS_DECIMALS = (\d+);/u.exec(persistenceSource)?.[1],
);

const devLabelHelpers = [
  functionSlice(stateSource, "export function getEffectiveDevLabelsForModel", "export function toLabelNum"),
  functionSlice(stateSource, "export function toLabelNum", "export function getRatioHeaderLabels"),
  functionSlice(stateSource, "export function getRatioHeaderLabels", "export function getOriginLabelTextForRatio"),
].join("\n");

function loadRoundAnalysisValue() {
  const slice = functionSlice(persistenceSource, "function roundAnalysisValue", "function trimTrailingNulls");
  return new Function(
    "ratioNumberOrNull",
    "roundRatio",
    "DFM_ANALYSIS_DECIMALS",
    `${slice}\nreturn roundAnalysisValue;`,
  )(ratioNumberOrNull, roundRatio, DFM_ANALYSIS_DECIMALS);
}

function loadPersistedSnapshotReader() {
  const slice = [
    functionSlice(ratiosTabSource, "let persistedRatioTriangleValues = null;", "export function applyPersistedRatioDerivedSnapshot"),
    functionSlice(ratiosTabSource, "export function applyPersistedRatioDerivedSnapshot", "export {"),
  ].join("\n");
  return new Function(
    "ratioNumberOrNull",
    `${slice}\nreturn { applyPersistedRatioDerivedSnapshot, read: () => persistedRatioTriangleValues };`,
  )(ratioNumberOrNull);
}

function loadRatioValuesBuilder(state) {
  const slice = [
    functionSlice(persistenceSource, "function roundAnalysisValue", "function trimTrailingNulls"),
    functionSlice(persistenceSource, "function trimTrailingNulls", "function normalizeSummaryUserEntryValue"),
    functionSlice(
      persistenceSource,
      "function buildCalculatedRatioTriangleValues",
      "function trimMatrixToReferenceRowShape",
    ),
    devLabelHelpers,
  ].join("\n");
  return new Function(
    "state",
    "calcRatio",
    "ratioNumberOrNull",
    "roundRatio",
    "DFM_ANALYSIS_DECIMALS",
    `${slice}\nreturn buildCalculatedRatioTriangleValues;`,
  )(state, calcRatio, ratioNumberOrNull, roundRatio, DFM_ANALYSIS_DECIMALS);
}

function loadPatternBuilder(state, ratioStrikeSet) {
  const slice = [
    functionSlice(summarySource, "function trimTrailingMaskCells", "export function buildRatioSelectionPattern"),
    functionSlice(summarySource, "export function buildRatioSelectionPattern", "export function buildAverageSelectionPayload"),
    devLabelHelpers,
  ].join("\n");
  return new Function(
    "state",
    "calcRatio",
    "ratioStrikeSet",
    `${slice}\nreturn buildRatioSelectionPattern;`,
  )(state, calcRatio, ratioStrikeSet);
}

// Row 0 is an all-zero origin, row 1 goes to zero part way across, row 2 is
// ordinary data. A zero left value has no ratio, which is exactly the case the
// two builders used to disagree about.
const MODEL = {
  origin_labels: ["2026 Q1", "2026 Q2", "2026 Q3"],
  dev_labels: ["3", "6", "9", "12"],
  values: [
    [0, 0, 0, 0],
    [2.461532, 11.924039, 0, 0],
    [10, 20, 40, 80],
  ],
  mask: [
    [true, true, true, true],
    [true, true, true, true],
    [true, true, true, true],
  ],
};

test("a null ratio stays null instead of rounding to zero", () => {
  const roundAnalysisValue = loadRoundAnalysisValue();
  // calcRatio returns null when there is no ratio to compute; Number(null) is 0
  // and finite, so an unguarded finite check turns that null into a real 0.
  assert.equal(calcRatio(0, 5), null);
  assert.equal(roundAnalysisValue(calcRatio(0, 5)), null);
  assert.equal(roundAnalysisValue(null), null);
  assert.equal(roundAnalysisValue(undefined), null);
  assert.equal(roundAnalysisValue(""), null);
  assert.equal(roundAnalysisValue(0), 0);
  // A zero later value is no ratio either: the origin has nothing to develop
  // from, so the cell reads as the muted placeholder and no average uses it.
  assert.equal(calcRatio(5, 0), null);
  assert.equal(roundAnalysisValue(calcRatio(5, 0)), null);
  assert.equal(roundAnalysisValue(calcRatio(2.461532, 11.924039)), 4.844154);
});

test("ratio-value rows and exclusion rows keep matching lengths", () => {
  const state = { model: MODEL };
  const buildCalculatedRatioTriangleValues = loadRatioValuesBuilder(state);
  const buildRatioSelectionPattern = loadPatternBuilder(state, new Set(["2,0"]));

  const ratioValues = buildCalculatedRatioTriangleValues();
  const pattern = buildRatioSelectionPattern();

  assert.equal(ratioValues.length, MODEL.origin_labels.length);
  assert.equal(pattern.length, MODEL.origin_labels.length);
  for (let row = 0; row < MODEL.origin_labels.length; row++) {
    assert.equal(
      ratioValues[row].length,
      pattern[row].length,
      `row ${row} (${MODEL.origin_labels[row]}) shapes disagree: `
        + `${JSON.stringify(ratioValues[row])} vs ${JSON.stringify(pattern[row])}`,
    );
  }
  // An all-zero origin has no ratios at all, so it must not fabricate any.
  assert.deepEqual(ratioValues[0], []);
  // The second origin develops once and then holds zero, so its one ratio is
  // followed by nothing rather than by a ratio of zero.
  assert.deepEqual(ratioValues[1], [4.844154]);
  assert.deepEqual(ratioValues[2], [2, 2, 2]);
  assert.deepEqual(pattern[2], [1, 0, 0]);
});

test("a stored null ratio renders as the grey placeholder, not a ratio of 0", () => {
  const snapshot = loadPersistedSnapshotReader();
  // A persisted row keeps interior nulls: this is the shape a saved method holds
  // for an origin whose first development period is zero.
  snapshot.applyPersistedRatioDerivedSnapshot({ "ratio_values": [[null, 1, 1.25]] });
  assert.deepEqual(snapshot.read(), [[null, 1, 1.25]]);

  // renderRatioTable keeps a persisted ratio only while it is finite, so the null
  // cell falls through to calcRatio and lands on the grey 1.0000 placeholder that
  // every other cell without a ratio uses.
  assert.equal(Number.isFinite(snapshot.read()[0][0]), false);
  assert.match(ratiosTabSource, /const ratio = Number\.isFinite\(persistedRatio\)/u);
  assert.match(ratiosTabSource, /td\.classList\.add\("ratioPlaceholder"\);/u);
});

test("the canonical ratio reader never turns an empty cell into a zero", () => {
  assert.equal(ratioNumberOrNull(null), null);
  assert.equal(ratioNumberOrNull(undefined), null);
  assert.equal(ratioNumberOrNull(""), null);
  assert.equal(ratioNumberOrNull("nope"), null);
  assert.equal(ratioNumberOrNull(0), 0);
  assert.equal(ratioNumberOrNull("1.25"), 1.25);
});
