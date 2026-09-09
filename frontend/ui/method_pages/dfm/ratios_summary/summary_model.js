/*
===============================================================================
DFM Ratios Summary Model and Row Configuration
===============================================================================
*/
import {
  registerSummaryFunctions,
  summaryRuntime,
} from "/ui/method_pages/dfm/ratios_summary/summary_runtime.js?v=20260819a";

const {
  state, calcRatio, roundRatio, roundHalfUp, formatRatio, computeAverageForColumn,
  ratioStrikeSet, selectedSummaryByCol, summaryRowConfigs, summaryRowMap, BASE_SUMMARY_ROWS,
  getShowNaBorders, getRatioSummaryRaf, setRatioSummaryRaf,
  getLastSummaryCtxRowId, setLastSummaryCtxRowId,
  getEffectiveDevLabelsForModel, getRatioHeaderLabels, buildSummaryRows,
  buildExcludedSetForColumn, parsePeriodsValue, parseExcludeValue, getDfmDecimalPlaces,
  getSummaryConfigKey, loadCustomSummaryRows, saveCustomSummaryRows,
  readExcelCell, readExcelCellsBatch, openExcelWorkbook,
  buildExcelRangeSourceCells, containsExcelRef, excelColumnFromIndex, findExcelRefsInline,
  formatExcelRef, normalizeExcelReferenceAddressCase, parseStandaloneExcelRange,
  collectDfmExternalLinkGroupsModel, getDfmExternalLinkHardCodeTargets, getDfmExternalLinkRangeTargets,
  DFM_FORMULA_VALIDATION_TIMEOUT_MS, beginFormulaValidationLease, clearFormulaValidationError,
  computeFormulaValidationTooltipLayout, revealAndFocusFormulaInput, showFormulaValidationError,
  wireSelectableTable, openDfmSummaryPlotWindow, hasDfmCellNote, showDfmCellNoteEditor,
  beginRatioHistoryAction, commitRatioHistoryAction,
} = summaryRuntime;

const tokenizeFormula = (...args) => summaryRuntime.tokenizeFormula(...args);
const isRatioEditMode = (...args) => summaryRuntime.isRatioEditMode(...args);

export const USER_ENTRY_FORMULA_EVALUATION_DECIMALS = 4;

export function formatUserEntryFormulaEvaluationValue(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric)
    ? numeric.toFixed(USER_ENTRY_FORMULA_EVALUATION_DECIMALS)
    : "";
}

// =============================================================================
// Ratio Selection Pattern + Average Selection
// =============================================================================
function trimTrailingMaskCells(row) {
  const out = Array.isArray(row) ? row.slice() : [];
  while (out.length && out[out.length - 1] === 2) {
    out.pop();
  }
  return out;
}

export function buildRatioSelectionPattern() {
  const model = state.model;
  if (!model || !Array.isArray(model.values) || !Array.isArray(model.mask)) return [];
  const origins = model.origin_labels || [];
  const devs = getEffectiveDevLabelsForModel(model);
  const ratioLabels = getRatioHeaderLabels(devs);
  const colCount = ratioLabels.length;
  const vals = model.values;
  const mask = model.mask;
  const pattern = [];

  for (let r = 0; r < origins.length; r++) {
    const row = [];
    for (let c = 0; c < colCount; c++) {
      const strikeKey = `${r},${c}`;
      if (c >= devs.length - 1) {
        row.push(2);
        continue;
      }
      const hasA = !!(mask[r] && mask[r][c]);
      const hasB = !!(mask[r] && mask[r][c + 1]);
      if (!hasA || !hasB) {
        row.push(2);
        continue;
      }
      const ratio = calcRatio(vals?.[r]?.[c], vals?.[r]?.[c + 1]);
      if (!Number.isFinite(ratio)) {
        row.push(2);
        continue;
      }
      row.push(ratioStrikeSet.has(strikeKey) ? 1 : 0);
    }
    pattern.push(trimTrailingMaskCells(row));
  }
  return pattern;
}

export function buildAverageSelectionPayload() {
  const model = state.model;
  if (!model || !Array.isArray(model.values) || !Array.isArray(model.mask)) {
    return { formulas: [], matrix: [] };
  }
  const devs = getEffectiveDevLabelsForModel(model);
  const ratioLabels = getRatioHeaderLabels(devs);
  const colCount = ratioLabels.length;
  const formulas = summaryRowConfigs.map((row) => String(row.label || row.id));
  const matrix = formulas.map(() => new Array(colCount).fill(0));

  for (let c = 0; c < colCount; c++) {
    const rowId = selectedSummaryByCol.get(c) || "";
    const idx = summaryRowConfigs.findIndex((cfg) => String(cfg.id) === String(rowId));
    if (idx >= 0 && matrix[idx]) matrix[idx][c] = 1;
  }

  return { formulas, matrix };
}

export function applyRatioSelectionPattern(pattern) {
  if (!Array.isArray(pattern)) return false;
  const model = state.model;
  if (!model || !Array.isArray(model.values) || !Array.isArray(model.mask)) return false;
  const devs = getEffectiveDevLabelsForModel(model);
  const ratioLabels = getRatioHeaderLabels(devs);
  const rowCount = Math.min(pattern.length, (model.origin_labels || []).length);
  const colCount = Math.min(ratioLabels.length, devs.length - 1);
  if (!rowCount || colCount <= 0) return false;

  ratioStrikeSet.clear();
  for (let r = 0; r < rowCount; r++) {
    const row = Array.isArray(pattern[r]) ? pattern[r] : [];
    for (let c = 0; c < colCount; c++) {
      if (row[c] === 1) ratioStrikeSet.add(`${r},${c}`);
    }
  }
  return true;
}

export function applySelectedSummaryFromSaved(selected, colCount) {
  if (!selected) return;
  selectedSummaryByCol.clear();
  if (Array.isArray(selected)) {
    if (selected.length && Array.isArray(selected[0])) {
      selected.forEach((entry) => {
        const col = Number(entry?.[0]);
        const rowId = entry?.[1];
        if (Number.isFinite(col) && typeof rowId === "string" && rowId) {
          selectedSummaryByCol.set(col, rowId);
        }
      });
      return;
    }
    for (let c = 0; c < Math.min(selected.length, colCount); c++) {
      const rowId = selected[c];
      if (typeof rowId === "string" && rowId) {
        selectedSummaryByCol.set(c, rowId);
      }
    }
  }
}

export function applyAverageSelectionFromSaved(formulas, matrix) {
  if (!Array.isArray(formulas) || !Array.isArray(matrix)) return;
  selectedSummaryByCol.clear();
  const formulaList = formulas.map((f) => String(f));
  const rowCount = matrix.length;
  let colCount = 0;
  for (let r = 0; r < rowCount; r++) {
    if (Array.isArray(matrix[r])) colCount = Math.max(colCount, matrix[r].length);
  }
  for (let c = 0; c < colCount; c++) {
    let idx = -1;
    for (let r = 0; r < rowCount; r++) {
      const row = Array.isArray(matrix[r]) ? matrix[r] : [];
      if (Number(row[c]) === 1) {
        idx = r;
        break;
      }
    }
    if (idx >= 0 && formulaList[idx]) {
      const label = formulaList[idx];
      const cfg = summaryRowConfigs.find((rowCfg) =>
        String(rowCfg.label || "") === label || String(rowCfg.id || "") === label
      );
      if (cfg?.id) selectedSummaryByCol.set(c, String(cfg.id));
    }
  }
}
// =============================================================================
// Summary Rows Ordering
// =============================================================================
function getCurrentSummaryOrder(summaryBody) {
  return Array.from(summaryBody.querySelectorAll("tr[data-row-id]"))
    .map((row) => row.dataset.rowId)
    .filter(Boolean);
}

function saveSummaryRowsInCurrentOrder(summaryBody) {
  const cfgKey = getSummaryConfigKey();
  if (!cfgKey) return;
  const order = getCurrentSummaryOrder(summaryBody);
  if (!order.length) return;
  const byId = new Map(summaryRowConfigs.map((row) => [String(row.id), row]));
  const used = new Set();
  const nextRows = [];
  order.forEach((id) => {
    const row = byId.get(String(id));
    if (!row || used.has(String(id))) return;
    nextRows.push({ ...row });
    used.add(String(id));
  });
  summaryRowConfigs.forEach((row) => {
    const id = String(row.id || "");
    if (!id || used.has(id)) return;
    nextRows.push({ ...row });
  });
  if (!nextRows.length) return;
  saveCustomSummaryRows(cfgKey, nextRows);
  buildSummaryRows();
}

// =============================================================================
// Summary Interactions (Drag, Context Menu, Avg Modal)
// =============================================================================
export function wireSummaryRowDrag(summaryBody) {
  if (!summaryBody || summaryBody.dataset.dragWired === "1") return;
  summaryBody.dataset.dragWired = "1";

  let dragRow = null;
  let dragGhost = null;
  let dragOverRow = null;
  let dropBefore = true;
  let dragStartIndex = -1;
  let dragStartX = 0;
  let dragStartY = 0;
  let dragMoved = false;
  let offsetY = 0;
  let fixedLeft = 0;

  const animateLayoutChange = (body, fn) => {
    const rows = Array.from(body.querySelectorAll("tr[data-row-id]"));
    const first = new Map(rows.map((row) => [row, row.getBoundingClientRect()]));
    fn();
    const last = new Map(rows.map((row) => [row, row.getBoundingClientRect()]));
    rows.forEach((row) => {
      const a = first.get(row);
      const b = last.get(row);
      if (!a || !b) return;
      const dx = a.left - b.left;
      const dy = a.top - b.top;
      if (!dx && !dy) return;
      row.style.transform = `translate(${dx}px, ${dy}px)`;
      row.style.transition = "none";
    });
    body.offsetHeight; // force reflow
    rows.forEach((row) => {
      if (!row.style.transform) return;
      row.style.transition = "";
      row.style.transform = "";
    });
    window.setTimeout(() => {
      rows.forEach((row) => {
        row.style.transition = "";
        row.style.transform = "";
      });
    }, 180);
  };

  const clearDropTarget = () => {
    if (dragOverRow) dragOverRow.classList.remove("summaryDropTarget");
    dragOverRow = null;
    dropBefore = true;
  };

  const updateDropTarget = (clientY) => {
    const rows = Array.from(summaryBody.querySelectorAll("tr[data-row-id]"));
    let target = null;
    let before = true;
    for (const row of rows) {
      const rect = row.getBoundingClientRect();
      if (clientY <= rect.bottom) {
        target = row;
        before = true;
        break;
      }
    }
    if (!target && rows.length) {
      target = rows[rows.length - 1];
      before = false;
    }
    if (target && dragStartIndex >= 0) {
      const targetIndex = rows.indexOf(target);
      if (targetIndex !== -1) {
        before = dragStartIndex < targetIndex ? false : true;
      }
    }
    if (dragOverRow && dragOverRow !== target) {
      dragOverRow.classList.remove("summaryDropTarget");
    }
    dragOverRow = target;
    dropBefore = before;
    if (dragOverRow) dragOverRow.classList.add("summaryDropTarget");
  };

  const onMouseMove = (e) => {
    if (!dragRow) return;
    if (!dragMoved) {
      const dx = Math.abs(e.clientX - dragStartX);
      const dy = Math.abs(e.clientY - dragStartY);
      if (dx < 4 && dy < 4) return;
      dragMoved = true;
      clearDropTarget();
      const rect = dragRow.getBoundingClientRect();
      offsetY = dragStartY - rect.top;
      fixedLeft = rect.left;
      const ghostTable = document.createElement("table");
      ghostTable.classList.add("summaryDragGhostTable");
      ghostTable.style.width = `${rect.width}px`;
      ghostTable.style.left = `${fixedLeft}px`;
      ghostTable.style.top = `${rect.top}px`;
      // The ghost sits outside the table, so its row number is the one the
      // dragged row had; the tbody's counter renumbers everything on drop.
      ghostTable.style.counterReset = `dfm-summary-row ${dragStartIndex}`;
      const ghostBody = document.createElement("tbody");
      const ghostRow = dragRow.cloneNode(true);
      ghostRow.classList.add("summaryDragGhostRow");
      const srcCells = Array.from(dragRow.children);
      const ghostCells = Array.from(ghostRow.children);
      srcCells.forEach((cell, idx) => {
        const w = Math.round(cell.getBoundingClientRect().width);
        const gc = ghostCells[idx];
        if (!gc || !w) return;
        gc.style.width = `${w}px`;
        gc.style.minWidth = `${w}px`;
        gc.style.maxWidth = `${w}px`;
      });
      ghostBody.appendChild(ghostRow);
      ghostTable.appendChild(ghostBody);
      dragGhost = ghostTable;
      document.body.appendChild(dragGhost);
      dragRow.classList.add("dragging");
    }
    if (!dragGhost) return;
    const top = e.clientY - offsetY;
    dragGhost.style.top = `${top}px`;
    dragGhost.style.left = `${fixedLeft}px`;
    updateDropTarget(e.clientY);
  };

  const endDrag = (commit) => {
    if (!dragRow) return;
    if (!dragMoved) {
      clearDropTarget();
      dragRow = null;
      dragStartIndex = -1;
      dragStartX = 0;
      dragStartY = 0;
      dragMoved = false;
      window.removeEventListener("mousemove", onMouseMove, true);
      window.removeEventListener("mouseup", onMouseUp, true);
      return;
    }
    if (dragGhost) {
      dragGhost.remove();
      dragGhost = null;
    }
    dragRow.classList.remove("dragging");
    if (commit && dragOverRow && dragOverRow !== dragRow) {
      animateLayoutChange(summaryBody, () => {
        const insertBeforeNode = dropBefore ? dragOverRow : dragOverRow.nextSibling;
        summaryBody.insertBefore(dragRow, insertBeforeNode);
      });
      saveSummaryRowsInCurrentOrder(summaryBody);
    }
    clearDropTarget();
    dragRow = null;
    offsetY = 0;
    fixedLeft = 0;
    dragStartIndex = -1;
    dragStartX = 0;
    dragStartY = 0;
    dragMoved = false;
    window.removeEventListener("mousemove", onMouseMove, true);
    window.removeEventListener("mouseup", onMouseUp, true);
  };

  const onMouseUp = (e) => {
    if (e) updateDropTarget(e.clientY);
    endDrag(true);
  };

  summaryBody.addEventListener("mousedown", (e) => {
    if (!isRatioEditMode()) return;
    const th = e.target?.closest?.("th.summaryDragHandle");
    if (!th) return;
    if (e.button !== 0) return;
    const row = th.closest("tr");
    if (!row || !row.dataset?.rowId) return;
    e.preventDefault();
    dragRow = row;
    const rows = Array.from(summaryBody.querySelectorAll("tr[data-row-id]"));
    dragStartIndex = rows.indexOf(row);
    dragStartX = e.clientX;
    dragStartY = e.clientY;
    dragMoved = false;
    dragOverRow = row;
    dropBefore = true;
    row.classList.add("summaryDropTarget");
    window.addEventListener("mousemove", onMouseMove, true);
    window.addEventListener("mouseup", onMouseUp, true);
  });
}


export function clearSummaryTableHighlight() {
  summaryRuntime.summaryCopyHighlight?.clearSelection?.();
}

function getAvgMenuEl() {
  return document.getElementById("dfmAvgMenu");
}

function getRatioMenuEl() {
  return document.getElementById("dfmRatioMenu");
}

function getResultsTabMenuEl() {
  return document.getElementById("dfmResultsTabMenu");
}

function updateRatioMenuLabel() {
  const menu = getRatioMenuEl();
  const btn = menu?.querySelector('[data-action="toggle-na-borders"]');
  if (!btn) return;
  btn.textContent = getShowNaBorders() ? "Hide Lower-Right Borders" : "Show Lower-Right Borders";
}

function applyNaBorderVisibility() {
  const wrap = document.getElementById("ratioWrap");
  if (!wrap) return;
  wrap.classList.toggle("showNaBorders", getShowNaBorders());
}

function getAvgModalEl() {
  return document.getElementById("dfmAvgModal");
}

function hideAvgMenu() {
  const menu = getAvgMenuEl();
  if (menu) menu.style.display = "none";
}

function hideResultsTabMenu() {
  const menu = getResultsTabMenuEl();
  if (menu) menu.style.display = "none";
}


function showAvgMenu(x, y) {
  const menu = getAvgMenuEl();
  if (!menu) return;
  menu.style.display = "block";
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
}


function isSummaryFormulaEditSessionActive(summaryTable = null) {
  if (!summaryRuntime.summaryFormulaEditState) return false;
  if (summaryTable && summaryRuntime.summaryFormulaEditState.summaryTable !== summaryTable) return false;
  const input = summaryRuntime.summaryFormulaEditState.input;
  return !!input && document.body.contains(input);
}

function normalizeAverageType(value) {
  const txt = String(value || "").trim().toLowerCase();
  return txt === "user_entry" ? "user_entry" : "custom";
}

export function isUserEntryConfig(cfg) {
  return normalizeAverageType(cfg?.averageType) === "user_entry";
}

function getCurrentRatioColumnCount() {
  const model = state.model;
  const devs = getEffectiveDevLabelsForModel(model || {});
  return getRatioHeaderLabels(devs).length;
}

function sanitizeUserEntryValue(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return 1;
  return n;
}

function escapeRegExp(text) {
  return String(text || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// The order references appear in the formula is what the colours are keyed on,
// so the labels come back in that order rather than in row order, and a label
// named twice keeps the colour it was given the first time.
function findReferencedLabels(formula, allLabels) {
  const labels = Array.isArray(allLabels) ? allLabels : [];
  if (!labels.length) return [];

  const byName = new Map(
    labels.map((label) => [String(label || "").trim().toLowerCase(), label])
  );
  const seen = new Set();
  const ordered = [];
  tokenizeFormula(formula)
    .filter((token) => token.type === "ref")
    .forEach((token) => {
      const name = token.text.slice(1, -1).trim().toLowerCase();
      if (!name || seen.has(name) || !byName.has(name)) return;
      seen.add(name);
      ordered.push(byName.get(name));
    });
  return ordered;
}

function getSummaryLabelToIdMap() {
  const rows = Array.isArray(summaryRowConfigs) ? summaryRowConfigs : [];
  return new Map(
    rows
      .map((cfg) => [String(cfg?.label || cfg?.id || "").trim(), String(cfg?.id || "").trim()])
      .filter(([label, rowId]) => label && rowId)
  );
}

function getSummaryCellRowLabel(cell) {
  return String(cell?.parentElement?.querySelector?.("th")?.textContent || "").trim();
}

function getFormulaReferencedLabels(raw) {
  const labelToId = getSummaryLabelToIdMap();
  if (!labelToId.size) return [];
  return findReferencedLabels(raw, Array.from(labelToId.keys()));
}

function replaceFormulaReferenceLabel(raw, oldLabel, newLabel) {
  const oldText = String(oldLabel || "").trim();
  const nextText = String(newLabel || "").trim();
  const source = String(raw || "");
  if (!oldText || !nextText || oldText.toLowerCase() === nextText.toLowerCase()) {
    return { changed: false, value: source };
  }

  const tokens = tokenizeFormula(source);
  for (const token of tokens) {
    if (token.type !== "ref") continue;
    const quote = token.text[0];
    const inner = token.text.slice(1, -1);
    if (inner.toLowerCase() !== oldText.toLowerCase()) continue;
    token.text = `${quote}${nextText}${quote}`;
    return { changed: true, value: tokens.map((item) => item.text).join("") };
  }

  const lit = escapeRegExp(oldText);
  const bare = new RegExp(lit, "i");
  if (!bare.test(source)) return { changed: false, value: source };
  return { changed: true, value: source.replace(bare, `"${nextText}"`) };
}

// One colour per reference, handed out in the order the formula names them.
export const SUMMARY_FORMULA_REF_COLOR_CLASSES = Object.freeze([
  "summaryFormulaRefColor0",
  "summaryFormulaRefColor1",
  "summaryFormulaRefColor2",
  "summaryFormulaRefColor3",
  "summaryFormulaRefColor4",
  "summaryFormulaRefColor5",
]);

/**
 * Row label -> colour class, for the rows one formula references. The formula
 * bar draws its reference pills from the same map, so a pill and the cell it
 * names always wear one colour.
 */
function buildSummaryFormulaReferenceColorsByLabel(raw) {
  return new Map(
    getFormulaReferencedLabels(raw).map((label, index) => [
      String(label).trim().toLowerCase(),
      SUMMARY_FORMULA_REF_COLOR_CLASSES[index % SUMMARY_FORMULA_REF_COLOR_CLASSES.length],
    ])
  );
}

/** Row id -> colour class, for the rows one formula references. */
function buildSummaryFormulaReferenceColors(raw) {
  const byLabel = buildSummaryFormulaReferenceColorsByLabel(raw);
  const colors = new Map();
  if (!byLabel.size) return colors;
  getSummaryLabelToIdMap().forEach((rowId, label) => {
    const colorClass = byLabel.get(String(label).trim().toLowerCase());
    if (colorClass && !colors.has(rowId)) colors.set(rowId, colorClass);
  });
  return colors;
}

function updateActiveSummaryFormulaReferenceUi(summaryTable) {
  if (!summaryTable) return;
  summaryTable.querySelectorAll("td.summaryCell.summaryFormulaActiveRefCell")
    .forEach((el) => el.classList.remove("summaryFormulaActiveRefCell"));

  const state = summaryRuntime.summaryFormulaEditState;
  const input = state?.input;
  if (!state || state.summaryTable !== summaryTable || !input || !document.body.contains(input)) return;
  if (!String(input.value || "").includes("=")) return;

  const editCol = Number(state.col);
  const editCell = state.cell;
  if (!Number.isFinite(editCol) || editCol < 0 || !editCell) return;

  buildSummaryFormulaReferenceColors(input.value).forEach((colorClass, rowId) => {
    const refCell = summaryTable.querySelector(
      `td.summaryCell[data-r="${CSS.escape(rowId)}"][data-col="${editCol}"]`
    );
    if (!refCell || refCell === editCell) return;
    refCell.classList.add("summaryFormulaActiveRefCell");
    refCell.classList.add(colorClass);
  });
}

/**
 * The one cell being edited is read from the formula bar rather than from the
 * saved formula: while a reference is retyped or dragged onto another row, the
 * saved formula still names the row it came from, and reading it would leave
 * the fill behind on a row the formula no longer uses.
 */
function getLiveUserEntryFormulaEdit(summaryTable) {
  const state = summaryRuntime.summaryFormulaEditState;
  if (!state || state.summaryTable !== summaryTable) return null;
  const input = state.input;
  if (!input || !document.body.contains(input)) return null;
  const rowId = String(state.rowId || "");
  const col = Number(state.col);
  if (!rowId || !Number.isFinite(col) || col < 0) return null;
  return { rowId, col, input };
}

/**
 * The one User Entry cell whose references are worth colouring: the formula
 * being typed while the formula bar is open, otherwise the cell the spreadsheet
 * cursor sits on. Each mode keeps its own marker on that cell — Edit mode the
 * active cell, Select mode the highlight anchor — so the colours appear only
 * while the formula that owns them is the one in view.
 */
function getFocusedUserEntryFormula(summaryTable) {
  const liveEdit = getLiveUserEntryFormulaEdit(summaryTable);
  if (liveEdit) {
    return {
      rowId: liveEdit.rowId,
      col: liveEdit.col,
      raw: String(liveEdit.input.value || "").trim(),
    };
  }
  const cell = isRatioEditMode()
    ? summaryTable.querySelector("td.summaryCell.summaryActiveCell")
    : summaryTable.querySelector("td.summaryCell.dfmTableActive");
  const rowId = String(cell?.dataset?.r || "");
  const col = Number(cell?.dataset?.col);
  if (!rowId || !Number.isFinite(col) || col < 0) return null;
  const cfg = summaryRowMap.get(rowId);
  if (!isUserEntryConfig(cfg)) return null;
  return { rowId, col, raw: String(getUserEntryInputForCol(cfg, col) || "").trim() };
}

function applyUserEntryReferenceHighlights(summaryTable) {
  if (!summaryTable) return;
  summaryTable.querySelectorAll("td.summaryCell.summaryFormulaReferencedCell")
    .forEach((el) => el.classList.remove("summaryFormulaReferencedCell"));
  SUMMARY_FORMULA_REF_COLOR_CLASSES.forEach((colorClass) => {
    summaryTable.querySelectorAll(`td.summaryCell.${colorClass}`)
      .forEach((el) => el.classList.remove(colorClass));
  });

  const focus = getFocusedUserEntryFormula(summaryTable);
  if (!focus || !focus.raw) return;
  buildSummaryFormulaReferenceColors(focus.raw).forEach((colorClass, refRowId) => {
    if (refRowId === focus.rowId) return;
    const refCell = summaryTable.querySelector(
      `td.summaryCell[data-r="${CSS.escape(refRowId)}"][data-col="${focus.col}"]`
    );
    if (!refCell) return;
    refCell.classList.add("summaryFormulaReferencedCell");
    refCell.classList.add(colorClass);
  });
}

function evaluateSimpleMathExpression(raw, referenceValues) {
  const txt = String(raw || "").trim();
  if (!txt) return null;
  let expr = txt.startsWith("=") ? txt.slice(1).trim() : txt;
  if (!expr) return null;
  if (referenceValues instanceof Map && referenceValues.size) {
    const entries = Array.from(referenceValues.entries())
      .filter(([label, value]) => String(label || "").trim() && Number.isFinite(Number(value)))
      .sort((a, b) => String(b[0]).length - String(a[0]).length);
    entries.forEach(([label, value]) => {
      const lit = escapeRegExp(String(label));
      const numeric = String(Number(value));
      expr = expr.replace(new RegExp(`"${lit}"`, "g"), numeric);
      expr = expr.replace(new RegExp(`'${lit}'`, "g"), numeric);
      expr = expr.replace(new RegExp(lit, "g"), numeric);
    });
  }
  // ROUND(x, digits) is the one function the formula language offers, so the
  // syntax check admits that word and nothing else made of letters.
  expr = expr.replace(/\bround\s*\(/giu, "ROUND(");
  if (!/^(?:[0-9+\-*/().,\s]|ROUND\()+$/u.test(expr)) return null;
  if (expr.includes("**")) return null;
  try {
    const out = Function("ROUND", `"use strict"; return (${expr});`)(
      (value, digits = 0) => roundHalfUp(Number(value), Number(digits)),
    );
    return Number.isFinite(out) ? Number(out) : null;
  } catch {
    return null;
  }
}

function stripFormulaEquals(raw) {
  const text = String(raw || "").trim();
  return text.startsWith("=") ? text.slice(1).trim() : text;
}

function splitFormulaTopLevel(raw, separator) {
  const text = String(raw || "");
  const parts = [];
  let current = "";
  let quote = "";
  let depthParen = 0;
  let depthBrace = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      current += ch;
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "(") {
      depthParen += 1;
      current += ch;
      continue;
    }
    if (ch === ")") {
      depthParen = Math.max(0, depthParen - 1);
      current += ch;
      continue;
    }
    if (ch === "{") {
      depthBrace += 1;
      current += ch;
      continue;
    }
    if (ch === "}") {
      depthBrace = Math.max(0, depthBrace - 1);
      current += ch;
      continue;
    }
    if (ch === separator && depthParen === 0 && depthBrace === 0) {
      parts.push(current.trim());
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current.trim());
  return parts;
}

function stripSingleOuterParens(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("(") || !text.endsWith(")")) return null;
  let quote = "";
  let depth = 0;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote) quote = "";
      continue;
    }
    if (ch === "\"" || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth += 1;
    if (ch === ")") depth -= 1;
    if (depth === 0 && i < text.length - 1) return null;
  }
  return depth === 0 ? text.slice(1, -1).trim() : null;
}

function parseArrayConstant(raw) {
  const text = String(raw || "").trim();
  if (!text.startsWith("{") || !text.endsWith("}")) {
    return { ok: false, error: "Array formulas must use an Excel-style array constant like ={1,2,3}." };
  }
  const inner = text.slice(1, -1).trim();
  if (!inner) return { ok: false, error: "Array formula is empty." };
  const rows = splitFormulaTopLevel(inner, ";").map((rowText) => splitFormulaTopLevel(rowText, ","));
  if (!rows.length || rows.some((row) => !row.length || row.some((item) => !String(item || "").trim()))) {
    return { ok: false, error: "Array formula contains an empty item." };
  }
  const width = rows[0].length;
  if (rows.some((row) => row.length !== width)) {
    return { ok: false, error: "Array formula rows must have the same length." };
  }
  return { ok: true, rows };
}

function parseSummaryArrayFormula(raw) {
  const expr = stripFormulaEquals(raw);
  if (!expr) return null;
  const transposeMatch = /^TRANSPOSE\s*/i.exec(expr);
  if (transposeMatch) {
    const args = stripSingleOuterParens(expr.slice(transposeMatch[0].length).trim());
    if (args == null) {
      return { ok: false, error: "TRANSPOSE array formulas must look like =TRANSPOSE({1;2;3})." };
    }
    const parsed = parseArrayConstant(args);
    if (!parsed.ok) return parsed;
    if (!parsed.rows.length || parsed.rows.some((row) => row.length !== 1)) {
      return { ok: false, error: "TRANSPOSE array formulas must contain a single-column array, like =TRANSPOSE({1;2;3})." };
    }
    return { ok: true, expressions: parsed.rows.map((row) => row[0]) };
  }
  if (!expr.startsWith("{")) return null;
  const parsed = parseArrayConstant(expr);
  if (!parsed.ok) return parsed;
  if (parsed.rows.length !== 1) {
    return { ok: false, error: "Use a 1-row array like ={1,2,3}, or wrap a single-column array with TRANSPOSE({1;2;3})." };
  }
  return { ok: true, expressions: parsed.rows[0] };
}

function normalizeUserEntryValues(values, minLength = 0) {
  const arr = Array.isArray(values) ? values.slice() : [];
  for (let i = 0; i < arr.length; i++) arr[i] = sanitizeUserEntryValue(arr[i]);
  while (arr.length < minLength) arr.push(1);
  return arr;
}

function normalizeUserEntryInputs(inputs, values, minLength = 0) {
  const arr = Array.isArray(inputs) ? inputs.slice() : [];
  const valueArr = Array.isArray(values) ? values : [];
  for (let i = 0; i < arr.length; i++) {
    arr[i] = String(arr[i] ?? "").trim();
  }
  while (arr.length < minLength) {
    const fallback = Number(valueArr[arr.length]);
    arr.push(Number.isFinite(fallback) && fallback > 0 ? String(fallback) : "1");
  }
  return arr;
}

function normalizeUserEntryDisplayInputs(displayInputs, minLength = 0) {
  const arr = Array.isArray(displayInputs) ? displayInputs.slice() : [];
  for (let i = 0; i < arr.length; i++) arr[i] = String(arr[i] ?? "").trim();
  while (arr.length < minLength) arr.push("");
  return arr;
}

export function getUserEntryValueForCol(cfg, col) {
  if (!isUserEntryConfig(cfg)) return 1;
  const values = normalizeUserEntryValues(cfg?.values, Math.max(0, col + 1));
  return sanitizeUserEntryValue(values[col]);
}

function getUserEntryInputForCol(cfg, col) {
  if (!isUserEntryConfig(cfg)) return "";
  const values = normalizeUserEntryValues(cfg?.values, Math.max(0, col + 1));
  const inputs = normalizeUserEntryInputs(cfg?.inputs ?? cfg?.formulas, values, Math.max(0, col + 1));
  const txt = String(inputs[col] ?? "").trim();
  if (txt) return txt;
  const fallback = sanitizeUserEntryValue(values[col]);
  return String(fallback);
}

function getUserEntryDisplayInputForCol(cfg, col) {
  if (!isUserEntryConfig(cfg)) return "";
  const displayInputs = normalizeUserEntryDisplayInputs(cfg?.displayInputs, Math.max(0, col + 1));
  return String(displayInputs[col] ?? "").trim();
}

function summaryTableHasUserEntryRows(summaryTable) {
  if (!summaryTable) return false;
  const rows = Array.from(summaryTable.querySelectorAll("tr[data-row-id]"));
  return rows.some((row) => {
    const rowId = String(row.dataset.rowId || "");
    const cfg = summaryRowMap.get(rowId);
    return !!cfg && isUserEntryConfig(cfg);
  });
}



function setModalValidationError(modal, inputSelector, errorSelector, message) {
  const input = modal?.querySelector?.(inputSelector);
  const error = modal?.querySelector?.(errorSelector);
  showFormulaValidationError({ inputEl: input, errorEl: error, message });
  input?.focus?.({ preventScroll: true });
}

function clearModalValidationError(modal, inputSelector, errorSelector) {
  const input = modal?.querySelector?.(inputSelector);
  const error = modal?.querySelector?.(errorSelector);
  clearFormulaValidationError({ inputEl: input, errorEl: error });
}

function showRenameModal(currentName, onCommit) {
  const modal = document.getElementById("dfmRenameModal");
  if (!modal) return;
  const nameInput = modal.querySelector("#dfmRenameName");
  if (nameInput) {
    nameInput.value = currentName || "";
  }
  clearModalValidationError(modal, "#dfmRenameName", "#dfmRenameError");
  summaryRuntime._renameModalCallback = onCommit;
  modal.classList.add("open");
  if (!modal.dataset.wired) {
    modal.dataset.wired = "1";
    const okBtn = modal.querySelector("#dfmRenameOk");
    const cancelBtn = modal.querySelector("#dfmRenameCancel");
    const backdrop = modal.querySelector(".dfmModalBackdrop");
    const commitRename = () => {
      const input = modal.querySelector("#dfmRenameName");
      const trimmed = String(input?.value || "").trim();
      if (!trimmed) return;
      if (summaryRuntime._renameModalCallback) {
        const ok = summaryRuntime._renameModalCallback(trimmed);
        if (ok === false) return;
      }
      summaryRuntime._renameModalCallback = null;
      modal.classList.remove("open");
    };
    const cancelRename = () => {
      summaryRuntime._renameModalCallback = null;
      clearModalValidationError(modal, "#dfmRenameName", "#dfmRenameError");
      modal.classList.remove("open");
    };
    okBtn?.addEventListener("click", commitRename);
    cancelBtn?.addEventListener("click", cancelRename);
    backdrop?.addEventListener("click", cancelRename);
    nameInput?.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); commitRename(); }
      else if (e.key === "Escape") { e.preventDefault(); cancelRename(); }
    });
    nameInput?.addEventListener("input", () => {
      clearModalValidationError(modal, "#dfmRenameName", "#dfmRenameError");
    });
  }
  window.requestAnimationFrame(() => {
    if (nameInput) { nameInput.focus(); nameInput.select(); }
  });
}

function hideAvgModal() {
  const modal = getAvgModalEl();
  if (modal) {
    clearModalValidationError(modal, "#dfmAvgName", "#dfmAvgError");
    modal.classList.remove("open");
  }
}

function showAvgModal() {
  const modal = getAvgModalEl();
  if (!modal) return;
  const nameInput = modal.querySelector("#dfmAvgName");
  const typeSelect = modal.querySelector("#dfmAvgType");
  const baseSelect = modal.querySelector("#dfmAvgBase");
  const periodInput = modal.querySelector("#dfmAvgPeriods");
  const excludeInput = modal.querySelector("#dfmAvgExclude");
  clearModalValidationError(modal, "#dfmAvgName", "#dfmAvgError");
  if (nameInput) nameInput.value = "User Entry";
  if (typeSelect) typeSelect.value = "custom";
  if (baseSelect) baseSelect.value = "simple";
  if (periodInput) periodInput.value = "";
  if (excludeInput) excludeInput.value = "None";
  const isUserEntry = normalizeAverageType(typeSelect?.value) === "user_entry";
  [baseSelect, periodInput, excludeInput].forEach((el) => {
    if (el) el.disabled = isUserEntry;
  });
  [baseSelect, periodInput, excludeInput].forEach((el) => {
    const field = el?.closest?.(".dfmModalField");
    if (field) field.classList.toggle("disabled", isUserEntry);
  });
  modal.classList.add("open");
}

function computeAutoName(base, periodsValue) {
  const label = base ? base.charAt(0).toUpperCase() + base.slice(1) : "User Entry";
  const p = String(periodsValue || "all").toLowerCase();
  const suffix = p === "all" ? "all" : p;
  return `${label} - ${suffix}`;
}

function computeAutoNameWithExclude(base, periodsValue, excludeValue) {
  const name = computeAutoName(base, periodsValue);
  const excludeCount = parseExcludeValue(excludeValue);
  if (excludeCount <= 0) return name;
  if (excludeCount === 1) return `${name} Ex hi/lo`;
  return `${name} Ex hi/lo x${excludeCount}`;
}

registerSummaryFunctions({
  trimTrailingMaskCells,
  buildRatioSelectionPattern,
  buildAverageSelectionPayload,
  applyRatioSelectionPattern,
  applySelectedSummaryFromSaved,
  applyAverageSelectionFromSaved,
  getCurrentSummaryOrder,
  saveSummaryRowsInCurrentOrder,
  wireSummaryRowDrag,
  clearSummaryTableHighlight,
  getAvgMenuEl,
  getRatioMenuEl,
  getResultsTabMenuEl,
  updateRatioMenuLabel,
  applyNaBorderVisibility,
  getAvgModalEl,
  hideAvgMenu,
  hideResultsTabMenu,
  showAvgMenu,
  isSummaryFormulaEditSessionActive,
  normalizeAverageType,
  isUserEntryConfig,
  getCurrentRatioColumnCount,
  sanitizeUserEntryValue,
  escapeRegExp,
  findReferencedLabels,
  getSummaryLabelToIdMap,
  getSummaryCellRowLabel,
  getFormulaReferencedLabels,
  buildSummaryFormulaReferenceColorsByLabel,
  replaceFormulaReferenceLabel,
  updateActiveSummaryFormulaReferenceUi,
  applyUserEntryReferenceHighlights,
  formatUserEntryFormulaEvaluationValue,
  evaluateSimpleMathExpression,
  stripFormulaEquals,
  splitFormulaTopLevel,
  stripSingleOuterParens,
  parseArrayConstant,
  parseSummaryArrayFormula,
  normalizeUserEntryValues,
  normalizeUserEntryInputs,
  normalizeUserEntryDisplayInputs,
  getUserEntryValueForCol,
  getUserEntryInputForCol,
  getUserEntryDisplayInputForCol,
  summaryTableHasUserEntryRows,
  setModalValidationError,
  clearModalValidationError,
  showRenameModal,
  hideAvgModal,
  showAvgModal,
  computeAutoName,
  computeAutoNameWithExclude,
});
