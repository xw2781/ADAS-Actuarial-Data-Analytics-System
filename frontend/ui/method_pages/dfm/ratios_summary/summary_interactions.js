/*
===============================================================================
DFM Ratios Summary Table Interactions
===============================================================================
*/
import {
  registerSummaryFunctions,
  summaryRuntime,
} from "/ui/method_pages/dfm/ratios_summary/summary_runtime.js?v=20260819a";
import { createRatioDragVisitTracker } from "/ui/method_pages/dfm/dfm_ratio_drag_tracker.js";

const {
  state, calcRatio, formatRatio, computeAverageForColumn,
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

const getAvgMenuEl = (...args) => summaryRuntime.getAvgMenuEl(...args);
const getRatioMenuEl = (...args) => summaryRuntime.getRatioMenuEl(...args);
const getResultsTabMenuEl = (...args) => summaryRuntime.getResultsTabMenuEl(...args);
const hideAvgMenu = (...args) => summaryRuntime.hideAvgMenu(...args);
const hideResultsTabMenu = (...args) => summaryRuntime.hideResultsTabMenu(...args);
const showAvgMenu = (...args) => summaryRuntime.showAvgMenu(...args);
const isSummaryFormulaEditSessionActive = (...args) => summaryRuntime.isSummaryFormulaEditSessionActive(...args);
const isUserEntryConfig = (...args) => summaryRuntime.isUserEntryConfig(...args);
const getSummaryCellRowLabel = (...args) => summaryRuntime.getSummaryCellRowLabel(...args);
const replaceFormulaReferenceLabel = (...args) => summaryRuntime.replaceFormulaReferenceLabel(...args);
const updateActiveSummaryFormulaReferenceUi = (...args) => summaryRuntime.updateActiveSummaryFormulaReferenceUi(...args);
const setModalValidationError = (...args) => summaryRuntime.setModalValidationError(...args);
const showRenameModal = (...args) => summaryRuntime.showRenameModal(...args);
const hideAvgModal = (...args) => summaryRuntime.hideAvgModal(...args);
const showAvgModal = (...args) => summaryRuntime.showAvgModal(...args);
const scrollSummaryFormulaInputToEnd = (...args) => summaryRuntime.scrollSummaryFormulaInputToEnd(...args);
const updateFormulaBarDisplayMode = (...args) => summaryRuntime.updateFormulaBarDisplayMode(...args);
const applyExcelRangeHighlights = (...args) => summaryRuntime.applyExcelRangeHighlights(...args);
const applyUserEntryReferenceHighlights = (...args) => summaryRuntime.applyUserEntryReferenceHighlights(...args);
const pasteUserEntryClipboardGrid = (...args) => summaryRuntime.pasteUserEntryClipboardGrid(...args);
const isSummaryFormulaCommitPending = (...args) => summaryRuntime.isSummaryFormulaCommitPending(...args);
const updateSummaryFormulaBarForCell = (...args) => summaryRuntime.updateSummaryFormulaBarForCell(...args);
const wireSummaryFormulaBarPointer = (...args) => summaryRuntime.wireSummaryFormulaBarPointer(...args);
const handleSummaryTableSelectionChange = (...args) => summaryRuntime.handleSummaryTableSelectionChange(...args);
const clearSummaryReferenceUi = (...args) => summaryRuntime.clearSummaryReferenceUi(...args);
const buildSummaryReferenceValues = (...args) => summaryRuntime.buildSummaryReferenceValues(...args);
const insertAtInputCursor = (...args) => summaryRuntime.insertAtInputCursor(...args);
const beginSummaryFormulaEditSession = (...args) => summaryRuntime.beginSummaryFormulaEditSession(...args);
const wireAvgModal = (...args) => summaryRuntime.wireAvgModal(...args);
const isRatioEditMode = (...args) => summaryRuntime.isRatioEditMode(...args);

export function wireSummaryContextMenu(summaryTable) {
  if (!summaryTable || summaryTable.dataset.menuWired === "1") return;
  summaryTable.dataset.menuWired = "1";
  wireAvgModal();
  summaryRuntime.summaryCopyHighlight?.destroy?.();
  summaryRuntime.summaryCopyHighlight = wireSelectableTable({
    container: summaryTable,
    rowKey: "copyR",
    colKey: "copyC",
    selectedClass: "dfmTableHighlight",
    activeClass: "dfmTableActive",
    edgeClasses: summaryRuntime.DFM_RATIO_HIGHLIGHT_EDGE_CLASSES,
    onSelectionChange: (selection) => handleSummaryTableSelectionChange(summaryTable, selection),
    exclusiveAcrossTables: true,
    canHandleKeyboardNavigation: () => document.getElementById("ratioWrap")?.dataset.interactionMode === "select",
    canStartLabelSelection: () => document.getElementById("ratioWrap")?.dataset.interactionMode === "select",
    scrollHost: () => document.getElementById("ratioWrapHost"),
    rowHeaderSelector: "th.summaryDragHandle",
    canStartPointerSelection: (event) => (
      (!isRatioEditMode() && !isSummaryFormulaEditSessionActive(summaryTable)) ||
      !!(event.shiftKey || event.ctrlKey || event.metaKey)
    ),
  });

  summaryTable.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const row = e.target?.closest?.("tr[data-row-id]");
    const noteCell = e.target?.closest?.("td.summaryCell");
    const onLabelCell = !!e.target?.closest?.("th.summaryDragHandle");
    summaryRuntime.summaryContextCellForNote = noteCell || null;
    setLastSummaryCtxRowId(row?.dataset?.rowId || null);
    const lastId = getLastSummaryCtxRowId();
    const cfg = summaryRowMap.get(lastId || "");
    const menu = getAvgMenuEl();
    if (menu) {
      const disableRename = !cfg;
      const disableDelete = !cfg || summaryRowConfigs.length <= 1;
      const renameBtn = menu.querySelector('[data-action="rename-average"]');
      const deleteBtn = menu.querySelector('[data-action="delete-average"]');
      const customBtn = menu.querySelector('[data-action="custom-average"]');
      const modeBtn = menu.querySelector('[data-action="toggle-summary-ratio-mode"]');
      const noteBtn = menu.querySelector('[data-action="add-summary-cell-note"]');
      const hasNote = !!(noteCell && hasDfmCellNote(noteCell));
      menu.querySelectorAll("[data-label-only], .dfmCtxSep[data-label-only]").forEach((item) => {
        item.style.display = onLabelCell ? "" : "none";
      });
      if (renameBtn) renameBtn.disabled = disableRename;
      if (deleteBtn) deleteBtn.disabled = disableDelete;
      if (customBtn) customBtn.disabled = !onLabelCell;
      if (modeBtn) {
        const targetMode = isRatioEditMode() ? "select" : "edit";
        modeBtn.dataset.targetMode = targetMode;
        const label = modeBtn.querySelector(".dfmCtxItemLabel");
        if (label) label.textContent = targetMode === "select" ? "Switch to Select Mode" : "Switch to Edit Mode";
      }
      if (noteBtn) {
        noteBtn.disabled = !noteCell;
        noteBtn.textContent = hasNote ? "Edit Cell Notes" : "Add Cell Notes";
      }
    }
    showAvgMenu(e.clientX, e.clientY);
  });

  if (!summaryRuntime.avgMenuWired) {
    summaryRuntime.avgMenuWired = true;
    const menu = getAvgMenuEl();
    menu?.addEventListener("click", async (e) => {
      const btn = e.target?.closest?.("[data-action]");
      if (!btn) return;
      const action = btn.dataset.action;
      hideAvgMenu();
      if (action === "toggle-summary-ratio-mode") {
        summaryRuntime._toggleRatioInteractionMode();
        return;
      }
      if (action === "copy-summary-value") {
        await summaryRuntime.summaryCopyHighlight?.copySelection?.();
        return;
      }
      if (action === "add-summary-cell-note") {
        showDfmCellNoteEditor(summaryRuntime.summaryContextCellForNote, { focus: true });
        return;
      }
      if (action === "custom-average") {
        showAvgModal();
        return;
      }
      if (action === "plot-summary-table") {
        const table = document.querySelector("#ratioWrap table.ratioSummaryTable");
        openDfmSummaryPlotWindow(table, {
          onSelectAveragePoint: ({ rowId, col }) => selectSummaryCell(table, rowId, col),
        });
        return;
      }
      if (action === "rename-average") {
        const lastId = getLastSummaryCtxRowId();
        if (!lastId) return;
        const cfg = summaryRowMap.get(lastId);
        if (!cfg) return;
        showRenameModal(cfg.label || "", (trimmed) => {
          const nameExists = summaryRowConfigs.some(
            (row) => String(row.label || "").trim().toLowerCase() === trimmed.toLowerCase()
          );
          if (nameExists && String(cfg.label || "").trim().toLowerCase() !== trimmed.toLowerCase()) {
            setModalValidationError(
              document.getElementById("dfmRenameModal"),
              "#dfmRenameName",
              "#dfmRenameError",
              "Average formula name already exists."
            );
            return false;
          }
          const cfgKey = getSummaryConfigKey();
          if (!cfgKey) return true;
          const nextRows = summaryRowConfigs.map((row) =>
            String(row.id) === String(lastId) ? { ...row, label: trimmed } : { ...row }
          );
          saveCustomSummaryRows(cfgKey, nextRows);
          summaryRuntime._renderRatioTable();
          return true;
        });
        return;
      }
      if (action === "delete-average") {
        const lastId = getLastSummaryCtxRowId();
        if (!lastId) return;
        if (summaryRowConfigs.length <= 1) return;
        const cfgKey = getSummaryConfigKey();
        if (!cfgKey) return;
        const nextRows = summaryRowConfigs
          .filter((row) => String(row.id) !== String(lastId))
          .map((row) => ({ ...row }));
        if (!nextRows.length) return;
        saveCustomSummaryRows(cfgKey, nextRows);
        for (const [col, rowId] of selectedSummaryByCol.entries()) {
          if (String(rowId) === String(lastId)) selectedSummaryByCol.delete(col);
        }
        summaryRuntime._renderRatioTable();
        return;
      }
    });

    document.addEventListener("mousedown", (e) => {
      const menuEl = getAvgMenuEl();
      if (menuEl && menuEl.style.display === "block" && !menuEl.contains(e.target)) {
        hideAvgMenu();
      }
      const ratioMenu = getRatioMenuEl();
      if (ratioMenu && ratioMenu.style.display === "block" && !ratioMenu.contains(e.target)) {
        ratioMenu.style.display = "none";
      }
      const resultsMenu = getResultsTabMenuEl();
      if (resultsMenu && resultsMenu.style.display === "block" && !resultsMenu.contains(e.target)) {
        resultsMenu.style.display = "none";
      }
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") {
        hideAvgMenu();
        hideAvgModal();
        const ratioMenu = getRatioMenuEl();
        if (ratioMenu) ratioMenu.style.display = "none";
        hideResultsTabMenu();
      }
    });
  }
}

// =============================================================================
// Summary Selection
// =============================================================================
function formatPercentDeveloped(value) {
  if (!Number.isFinite(value)) return "";
  return `${(value * 100).toFixed(1)}%`;
}

function ensureSelectedRowValues(summaryTable, selectedTable) {
  if (!selectedTable) return;
  const selectedRow = selectedTable.querySelector('tr[data-row-id="selected"]');
  const cumulativeRow = selectedTable.querySelector('tr[data-row-id="cumulative"]');
  const developedRow = selectedTable.querySelector('tr[data-row-id="percent-developed"]');
  if (!selectedRow) return;
  const selectedCells = Array.from(selectedRow.querySelectorAll("td[data-col]"));
  const selectedValues = new Array(selectedCells.length).fill(null);
  const cumulativeValues = new Array(selectedCells.length).fill(null);

  selectedCells.forEach((td) => {
    const col = Number(td.dataset.col);
    const rowId = selectedSummaryByCol.get(col);
    if (!rowId) {
      td.textContent = "";
      return;
    }
    const cell = summaryTable?.querySelector(`td.summaryCell[data-r="${rowId}"][data-col="${col}"]`);
    if (!cell) {
      selectedSummaryByCol.delete(col);
      td.textContent = "";
      td.dataset.copyValue = "";
      return;
    }
    // The summary cell carries the factor it holds in full; the selected row
    // chains and copies that number, not the text printed at Decimal Places.
    const copyValue = cell.dataset.copyValue ?? "";
    td.textContent = cell.textContent || "";
    td.dataset.copyValue = copyValue;
    const val = Number(copyValue);
    if (copyValue !== "" && Number.isFinite(val)) selectedValues[col] = val;
  });

  if (cumulativeRow) {
    const cumCells = Array.from(cumulativeRow.querySelectorAll("td[data-col]"));
    let running = null;
    for (let i = selectedValues.length - 1; i >= 0; i--) {
      const selVal = selectedValues[i];
      const target = cumCells[i];
      if (!target) continue;
      if (!Number.isFinite(selVal)) {
        target.textContent = "";
        target.dataset.copyValue = "";
        running = null;
        continue;
      }
      if (i === selectedValues.length - 1) {
        running = selVal;
      } else if (Number.isFinite(running)) {
        running = selVal * running;
      } else {
        target.textContent = "";
        target.dataset.copyValue = "";
        running = null;
        continue;
      }
      cumulativeValues[i] = running;
      target.textContent = formatRatio(running, getDfmDecimalPlaces());
      target.dataset.copyValue = String(running);
    }
  }

  if (developedRow) {
    const developedCells = Array.from(developedRow.querySelectorAll("td[data-col]"));
    developedCells.forEach((target) => {
      const col = Number(target.dataset.col);
      const cumulativeValue = cumulativeValues[col];
      if (!Number.isFinite(cumulativeValue) || cumulativeValue === 0) {
        target.textContent = "";
        target.dataset.copyValue = "";
        return;
      }
      const developed = 1 / cumulativeValue;
      target.textContent = formatPercentDeveloped(developed);
      target.dataset.copyValue = String(developed);
    });
  }
}

export function applySummarySelection(summaryTable, selectedTable) {
  if (!summaryTable) return;
  const cols = new Set();
  selectedSummaryByCol.forEach((_rowId, col) => cols.add(Number(col)));
  cols.forEach((col) => {
    const rowId = selectedSummaryByCol.get(col);
    const cell = summaryTable.querySelector(`td.summaryCell[data-r="${rowId}"][data-col="${col}"]`);
    if (!cell) {
      selectedSummaryByCol.delete(col);
      return;
    }
    summaryTable.querySelectorAll(`td.summaryCell[data-col="${col}"]`)
      .forEach((el) => el.classList.remove("ratioSelectedCell"));
    cell.classList.add("ratioSelectedCell");
  });
  ensureSelectedRowValues(summaryTable, selectedTable);
}

export function selectSummaryCell(summaryTable, rowId, col) {
  if (!summaryTable) return false;
  const rowKey = String(rowId || "");
  const colIndex = Number(col);
  if (!rowKey || !Number.isFinite(colIndex) || colIndex < 0) return false;
  const cell = summaryTable.querySelector(`td.summaryCell[data-r="${CSS.escape(rowKey)}"][data-col="${colIndex}"]`);
  if (!cell) return false;
  beginRatioHistoryAction("summary-cell-click");
  const selectedTable = summaryTable.closest("#ratioWrap")?.querySelector("table.ratioSelectedTable");
  selectedSummaryByCol.set(colIndex, rowKey);
  summaryTable.querySelectorAll(`td.summaryCell[data-col="${colIndex}"]`)
    .forEach((el) => el.classList.remove("ratioSelectedCell"));
  cell.classList.add("ratioSelectedCell");
  summaryTable.querySelectorAll("td.summaryCell.summaryActiveCell")
    .forEach((el) => el.classList.remove("summaryActiveCell"));
  cell.classList.add("summaryActiveCell");
  summaryRuntime.summaryActiveCellState = { rowId: rowKey, col: colIndex };
  applyExcelRangeHighlights(summaryTable);
  applyUserEntryReferenceHighlights(summaryTable);
  ensureSelectedRowValues(summaryTable, selectedTable);
  updateSummaryFormulaBarForCell(cell);
  summaryRuntime._onRatioStateMutated();
  commitRatioHistoryAction("summary-cell-click");
  return true;
}

export function initDefaultSummarySelection(summaryTable) {
  if (!summaryTable) return;
  const firstRow = summaryTable.querySelector("tr[data-row-id]");
  if (!firstRow) return;
  const rowId = String(firstRow.dataset.rowId || "");
  if (!rowId) return;
  const cols = summaryTable.querySelectorAll("td.summaryCell[data-col]");
  const maxCol = cols.length ? Math.max(...Array.from(cols).map((c) => Number(c.dataset.col))) : -1;
  if (maxCol < 0) return;
  for (let c = 0; c <= maxCol; c++) {
    if (!selectedSummaryByCol.has(c)) selectedSummaryByCol.set(c, rowId);
  }
}

export function wireSummarySelection(summaryTable, selectedTable) {
  if (!summaryTable || summaryTable.dataset.selectionWired === "1") return;
  summaryRuntime.summarySelectionDestroy?.();
  summaryTable.dataset.selectionWired = "1";
  const listenerCleanup = [];
  const listen = (target, type, handler, options) => {
    target.addEventListener(type, handler, options);
    listenerCleanup.push(() => target.removeEventListener(type, handler, options));
  };
  let dragActive = false;
  const dragVisits = createRatioDragVisitTracker();
  let pasteArmed = false;

  const finishSummaryCellDrag = () => {
    if (dragActive) {
      commitRatioHistoryAction("summary-cell-click");
    }
    dragActive = false;
    dragVisits.reset();
  };

  const isFormulaReferenceMode = () => {
    if (!isSummaryFormulaEditSessionActive(summaryTable)) return false;
    const input = summaryRuntime.summaryFormulaEditState?.input;
    if (!input) return false;
    if (input.disabled || input.readOnly || isSummaryFormulaCommitPending(input)) return false;
    if (summaryRuntime.summaryFormulaBarState.input === input && summaryRuntime.summaryFormulaBarState.mode === "validating") return false;
    return String(input.value || "").includes("=");
  };

  const updateReferenceHoverUi = (hoverCell) => {
    clearSummaryReferenceUi(summaryTable);
    if (!isFormulaReferenceMode()) return;
    const editState = summaryRuntime.summaryFormulaEditState;
    const editCol = Number(editState?.col);
    const editCell = editState?.cell;
    if (!Number.isFinite(editCol) || !editCell) return;
    summaryTable.querySelectorAll(`td.summaryCell[data-col="${editCol}"]`).forEach((cell) => {
      if (cell === editCell) return;
      cell.classList.add("summaryRefCandidate");
    });
    if (hoverCell && hoverCell !== editCell) {
      const hoverCol = Number(hoverCell.dataset.col);
      if (hoverCol === editCol) hoverCell.classList.add("summaryRefHover");
    }
    updateActiveSummaryFormulaReferenceUi(summaryTable);
  };

  const isNearCellBorder = (e, cell) => {
    const rect = cell?.getBoundingClientRect?.();
    if (!rect) return false;
    const tolerance = 6;
    const left = Math.abs(e.clientX - rect.left);
    const right = Math.abs(e.clientX - rect.right);
    const top = Math.abs(e.clientY - rect.top);
    const bottom = Math.abs(e.clientY - rect.bottom);
    return Math.min(left, right, top, bottom) <= tolerance;
  };

  /**
   * A reference cell is dragged from its border, the way a spreadsheet moves a
   * range, while its middle stays a click target that picks the reference. The
   * cursor has to say which of the two is under the pointer, so the hot zone is
   * marked from the same border test that starts the drag.
   */
  const updateReferenceDragReadyUi = (e) => {
    summaryTable.querySelectorAll("td.summaryCell.summaryFormulaRefDragReady")
      .forEach((cell) => cell.classList.remove("summaryFormulaRefDragReady"));
    if (!e || !isFormulaReferenceMode()) return;
    const cell = e.target?.closest?.("td.summaryCell.summaryFormulaActiveRefCell");
    if (!cell || !summaryTable.contains(cell) || !isNearCellBorder(e, cell)) return;
    cell.classList.add("summaryFormulaRefDragReady");
  };

  const getReferenceDragTarget = (e) => {
    const target = document.elementFromPoint(e.clientX, e.clientY);
    const cell = target?.closest?.("td.summaryCell");
    const dragState = summaryRuntime.summaryReferenceDragState;
    if (!cell || !dragState || !summaryTable.contains(cell)) return null;
    if (cell === dragState.editCell) return null;
    const col = Number(cell.dataset.col);
    return col === dragState.col ? cell : null;
  };

  const clearReferenceDragTargetUi = () => {
    summaryTable.querySelectorAll("td.summaryCell.summaryFormulaRefDragTarget")
      .forEach((cell) => cell.classList.remove("summaryFormulaRefDragTarget"));
  };

  const applyReferenceDragTarget = (cell) => {
    const dragState = summaryRuntime.summaryReferenceDragState;
    if (!dragState || !cell) return;
    const nextLabel = getSummaryCellRowLabel(cell);
    if (!nextLabel) return;
    const replaced = replaceFormulaReferenceLabel(dragState.input.value, dragState.currentLabel, nextLabel);
    clearReferenceDragTargetUi();
    cell.classList.add("summaryFormulaRefDragTarget");
    if (!replaced.changed) return;
    dragState.input.value = replaced.value;
    dragState.currentLabel = nextLabel;
    dragState.currentCell = cell;
    beginSummaryFormulaEditSession(summaryTable, dragState.editCell, dragState.input, dragState.col);
    updateSummaryFormulaBarForCell(dragState.editCell);
    updateActiveSummaryFormulaReferenceUi(summaryTable);
    scrollSummaryFormulaInputToEnd(dragState.input);
  };

  const finishReferenceDrag = () => {
    if (!summaryRuntime.summaryReferenceDragState) return;
    const input = summaryRuntime.summaryReferenceDragState.input;
    summaryRuntime.summaryReferenceDragState = null;
    clearReferenceDragTargetUi();
    summaryTable.classList.remove("summaryFormulaRefDragging");
    updateActiveSummaryFormulaReferenceUi(summaryTable);
    input?.focus?.();
    window.removeEventListener("mousemove", onReferenceDragMove, true);
    window.removeEventListener("mouseup", onReferenceDragUp, true);
    window.removeEventListener("blur", finishReferenceDrag, true);
  };

  function onReferenceDragMove(e) {
    if (!summaryRuntime.summaryReferenceDragState) return;
    e.preventDefault();
    const targetCell = getReferenceDragTarget(e);
    if (targetCell) applyReferenceDragTarget(targetCell);
  }

  function onReferenceDragUp(e) {
    if (summaryRuntime.summaryReferenceDragState && e) {
      const targetCell = getReferenceDragTarget(e);
      if (targetCell) applyReferenceDragTarget(targetCell);
    }
    finishReferenceDrag();
  }

  const tryStartReferenceDrag = (e) => {
    if (!isFormulaReferenceMode()) return false;
    const cell = e.target?.closest?.("td.summaryCell.summaryFormulaActiveRefCell");
    if (!cell || !isNearCellBorder(e, cell)) return false;
    const editState = summaryRuntime.summaryFormulaEditState;
    const input = editState?.input;
    const editCol = Number(editState?.col);
    const editCell = editState?.cell;
    const currentLabel = getSummaryCellRowLabel(cell);
    if (!input || !Number.isFinite(editCol) || !editCell || !currentLabel) return false;
    e.preventDefault();
    e.stopPropagation();
    summaryRuntime.summaryReferenceDragState = {
      summaryTable,
      input,
      editCell,
      col: editCol,
      currentCell: cell,
      currentLabel,
    };
    cell.classList.add("summaryFormulaRefDragTarget");
    // The pointer leaves the cell it started on, so the gesture's cursor belongs
    // to the table rather than to any one cell.
    summaryTable.classList.add("summaryFormulaRefDragging");
    window.addEventListener("mousemove", onReferenceDragMove, true);
    window.addEventListener("mouseup", onReferenceDragUp, true);
    window.addEventListener("blur", finishReferenceDrag, true);
    return true;
  };

  const tryInsertReferenceFromEvent = (e) => {
    if (!isFormulaReferenceMode()) return false;
    const editState = summaryRuntime.summaryFormulaEditState;
    const editCol = Number(editState?.col);
    const editCell = editState?.cell;
    const input = editState?.input;
    if (!Number.isFinite(editCol) || !editCell || !input) return false;
    const cell = e.target?.closest?.("td.summaryCell");
    if (!cell || cell === editCell) return false;
    const col = Number(cell.dataset.col);
    if (!Number.isFinite(col) || col !== editCol) return false;
    const rowLabel = String(cell.parentElement?.querySelector("th")?.textContent || "").trim();
    if (!rowLabel) return false;
    e.preventDefault();
    e.stopPropagation();
    if (cell.classList.contains("summaryFormulaActiveRefCell")) {
      input.focus();
      updateReferenceHoverUi(cell);
      return true;
    }
    insertAtInputCursor(input, `"${rowLabel}"`);
    input.focus();
    updateReferenceHoverUi(cell);
    updateSummaryFormulaBarForCell(editCell);
    return true;
  };

  const selectCell = (cell) => {
    if (!cell) return;
    if (isSummaryFormulaEditSessionActive(summaryTable)) return;
    const col = Number(cell.dataset.col);
    const rowId = String(cell.dataset.r || "");
    if (!Number.isFinite(col) || !rowId) return;
    selectedSummaryByCol.set(col, rowId);
    summaryTable.querySelectorAll(`td.summaryCell[data-col="${col}"]`)
      .forEach((el) => el.classList.remove("ratioSelectedCell"));
    cell.classList.add("ratioSelectedCell");
    ensureSelectedRowValues(summaryTable, selectedTable);
    summaryRuntime._onRatioStateMutated();
  };

  const setActiveCell = (cell, syncSelection) => {
    if (!cell) {
      pasteArmed = false;
      summaryRuntime.summaryActiveCellState = { rowId: "", col: -1 };
      summaryTable.querySelectorAll("td.summaryCell.summaryActiveCell")
        .forEach((el) => el.classList.remove("summaryActiveCell"));
      applyExcelRangeHighlights(summaryTable);
      applyUserEntryReferenceHighlights(summaryTable);
      updateSummaryFormulaBarForCell(null);
      return;
    }
    if (isSummaryFormulaEditSessionActive(summaryTable) && summaryRuntime.summaryFormulaEditState?.cell !== cell) {
      updateSummaryFormulaBarForCell(summaryRuntime.summaryFormulaEditState.cell);
      return;
    }
    const rowId = String(cell.dataset.r || "");
    const col = Number(cell.dataset.col);
    if (!rowId || !Number.isFinite(col) || col < 0) return;
    summaryTable.querySelectorAll("td.summaryCell.summaryActiveCell")
      .forEach((el) => el.classList.remove("summaryActiveCell"));
    cell.classList.add("summaryActiveCell");
    summaryRuntime.summaryCopyHighlight?.selectCell?.(cell, false);
    summaryRuntime.summaryActiveCellState = { rowId, col };
    pasteArmed = true;
    if (syncSelection) selectCell(cell);
    applyExcelRangeHighlights(summaryTable);
    applyUserEntryReferenceHighlights(summaryTable);
    updateSummaryFormulaBarForCell(cell);
  };

  const selectFormulaRow = (row) => {
    if (!row || isSummaryFormulaEditSessionActive(summaryTable)) return;
    const rowId = String(row.dataset.rowId || "");
    if (!rowId) return;
    const cells = Array.from(row.querySelectorAll("td.summaryCell[data-col]"));
    if (!cells.length) return;
    const selectedCells = [];
    let changed = false;
    cells.forEach((cell) => {
      const col = Number(cell.dataset.col);
      if (!Number.isFinite(col)) return;
      selectedCells.push(cell);
      if (selectedSummaryByCol.get(col) !== rowId) changed = true;
    });
    const firstCell = selectedCells[0] || null;
    if (!changed) {
      setActiveCell(firstCell, false);
      return;
    }
    beginRatioHistoryAction("summary-row-click");
    selectedCells.forEach((cell) => {
      const col = Number(cell.dataset.col);
      if (!Number.isFinite(col)) return;
      selectedSummaryByCol.set(col, rowId);
    });
    summaryTable.querySelectorAll("td.summaryCell.ratioSelectedCell")
      .forEach((el) => el.classList.remove("ratioSelectedCell"));
    selectedCells.forEach((cell) => cell.classList.add("ratioSelectedCell"));
    ensureSelectedRowValues(summaryTable, selectedTable);
    setActiveCell(firstCell, false);
    summaryRuntime._onRatioStateMutated();
    commitRatioHistoryAction("summary-row-click");
  };

  const getCurrentActiveCell = () => {
    const { rowId, col } = summaryRuntime.summaryActiveCellState;
    if (rowId && Number.isFinite(col) && col >= 0) {
      const byState = summaryTable.querySelector(`td.summaryCell[data-r="${rowId}"][data-col="${col}"]`);
      if (byState) return byState;
    }
    return summaryTable.querySelector("td.summaryCell.summaryActiveCell");
  };

  const moveActiveCell = (rowDelta, colDelta) => {
    const rows = Array.from(summaryTable.querySelectorAll("tr[data-row-id]"));
    if (!rows.length) return;
    const current = getCurrentActiveCell();
    if (!current) return;
    const currentRowId = String(current.dataset.r || "");
    const currentCol = Number(current.dataset.col);
    if (!currentRowId || !Number.isFinite(currentCol)) return;

    const rowIndex = Math.max(0, rows.findIndex((row) => String(row.dataset.rowId || "") === currentRowId));
    const rowCount = rows.length;
    const colCount = rows[0]?.querySelectorAll("td.summaryCell").length || 0;
    if (!colCount) return;

    const nextRow = Math.max(0, Math.min(rowCount - 1, rowIndex + rowDelta));
    const nextCol = Math.max(0, Math.min(colCount - 1, currentCol + colDelta));
    const nextCell = rows[nextRow]?.querySelector(`td.summaryCell[data-col="${nextCol}"]`);
    if (!nextCell) return;
    setActiveCell(nextCell, false);
    summaryRuntime.scrollSpreadsheetCellIntoView(
      nextCell,
      document.getElementById("ratioWrapHost"),
    );
  };

  listen(summaryTable, "mousedown", (e) => {
    const formulaEditing = isSummaryFormulaEditSessionActive(summaryTable);
    if (!isRatioEditMode() && !formulaEditing) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (tryStartReferenceDrag(e)) return;
    if (tryInsertReferenceFromEvent(e)) return;
    if (!isRatioEditMode()) return;
    if (e.button !== 0) return;
    const cell = e.target?.closest?.("td.summaryCell");
    if (!cell) return;
    finishSummaryCellDrag();
    e.preventDefault();
    dragActive = true;
    beginRatioHistoryAction("summary-cell-click");
    const key = `${cell.dataset.r || ""},${cell.dataset.col || ""}`;
    if (dragVisits.visit(key)) setActiveCell(cell, true);
  });

  listen(summaryTable, "mousemove", (e) => {
    const formulaEditing = isSummaryFormulaEditSessionActive(summaryTable);
    if (!isRatioEditMode() && !formulaEditing) return;
    if (summaryRuntime.summaryReferenceDragState) return;
    const hoverCell = e.target?.closest?.("td.summaryCell");
    updateReferenceHoverUi(hoverCell || null);
    updateReferenceDragReadyUi(e);
    if (!isRatioEditMode()) return;
    if (!dragActive) return;
    const cell = e.target?.closest?.("td.summaryCell");
    if (!cell) return;
    const key = `${cell.dataset.r || ""},${cell.dataset.col || ""}`;
    if (!dragVisits.visit(key)) return;
    setActiveCell(cell, true);
  });

  listen(window, "mouseup", finishSummaryCellDrag);
  listen(window, "blur", finishSummaryCellDrag);
  listen(document, "visibilitychange", () => {
    if (document.hidden) finishSummaryCellDrag();
  });

  listen(summaryTable, "click", (e) => {
    if (!isRatioEditMode()) return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) return;
    if (e.defaultPrevented) return;
    if (dragActive) return;
    const rowHead = e.target?.closest?.("th.summaryDragHandle");
    if (rowHead) {
      e.preventDefault();
      selectFormulaRow(rowHead.closest("tr[data-row-id]"));
      return;
    }
    const cell = e.target?.closest?.("td.summaryCell");
    if (!cell) return;
    setActiveCell(cell, true);
  });

  listen(summaryTable, "mouseleave", () => {
    updateReferenceHoverUi(null);
  });

  wireSummaryFormulaBarPointer(summaryTable, listen);

  listen(document, "keydown", (e) => {
    if (!document.body.contains(summaryTable)) return;
    const target = e.target;
    if (target?.closest?.("input, textarea, [contenteditable='true']")) return;
    if (!isRatioEditMode()) return;
    if (!summaryTable.querySelector("td.summaryCell.summaryActiveCell")) return;
    if (e.key === "ArrowUp") {
      e.preventDefault();
      moveActiveCell(-1, 0);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      moveActiveCell(1, 0);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      moveActiveCell(0, -1);
    } else if (e.key === "ArrowRight") {
      e.preventDefault();
      moveActiveCell(0, 1);
    } else if (e.key === "=" && !e.ctrlKey && !e.altKey && !e.metaKey) {
      const cell = getCurrentActiveCell();
      if (!cell) return;
      const rowId = String(cell.dataset.r || "");
      const cfg = summaryRowMap.get(rowId);
      if (!cfg || !isUserEntryConfig(cfg)) return;
      e.preventDefault();
      const barEl = document.getElementById("dfmSummaryFormulaBar");
      const barInput = barEl?.querySelector("#dfmSummaryFormulaBarInput");
      if (
        barInput &&
        !barInput.disabled &&
        !barInput.readOnly &&
        !isSummaryFormulaCommitPending(barInput) &&
        summaryRuntime.summaryFormulaBarState.mode !== "validating"
      ) {
        barInput.value = "= ";
        updateFormulaBarDisplayMode(barEl, true);
        barInput.focus();
        const editRowId = String(barInput.dataset.rowId || rowId);
        const editCol = Number(barInput.dataset.col);
        const editCell = summaryTable.querySelector(
          `td.summaryCell[data-r="${editRowId}"][data-col="${editCol}"]`
        );
        if (editCell && Number.isFinite(editCol) && editCol >= 0) {
          beginSummaryFormulaEditSession(summaryTable, editCell, barInput, editCol);
        }
      }
    }
  });

  listen(document, "mousedown", (e) => {
    if (!summaryTable.contains(e.target)) pasteArmed = false;
  });

  listen(document, "paste", (e) => {
    if (!isRatioEditMode()) return;
    if (!pasteArmed || !document.body.contains(summaryTable)) return;
    if (e.target?.closest?.("input, textarea, select, [contenteditable='true']")) return;
    const cell = getCurrentActiveCell();
    if (!cell || !isUserEntryConfig(summaryRowMap.get(String(cell.dataset.r || "")))) return;
    const text = e.clipboardData?.getData("text/plain");
    if (typeof text !== "string") return;
    e.preventDefault();
    pasteUserEntryClipboardGrid(summaryTable, selectedTable, cell, text);
  });

  const initCell = summaryTable.querySelector(
    `td.summaryCell[data-r="${summaryRuntime.summaryActiveCellState.rowId}"][data-col="${summaryRuntime.summaryActiveCellState.col}"]`
  );
  setActiveCell(initCell || null, false);
  summaryRuntime.summarySelectionDestroy = () => {
    finishReferenceDrag();
    finishSummaryCellDrag();
    while (listenerCleanup.length) listenerCleanup.pop()?.();
    delete summaryTable.dataset.selectionWired;
    if (summaryRuntime.summarySelectionDestroy) {
      summaryRuntime.summarySelectionDestroy = null;
    }
  };
}

registerSummaryFunctions({
  wireSummaryContextMenu,
  formatPercentDeveloped,
  ensureSelectedRowValues,
  applySummarySelection,
  selectSummaryCell,
  initDefaultSummarySelection,
  wireSummarySelection,
});
