export function normalizeRange(r0, c0, r1, c1) {
  return {
    r0: Math.min(r0, r1),
    r1: Math.max(r0, r1),
    c0: Math.min(c0, c1),
    c1: Math.max(c0, c1),
  };
}

let activeSelectableTable = null;

export function moveActiveSelectableTableSelection(deltaRow, deltaCol, settings = {}) {
  if (!activeSelectableTable?.isActive || typeof activeSelectableTable.moveSelection !== "function") return false;
  return activeSelectableTable.moveSelection(deltaRow, deltaCol, settings);
}

export function getTopLeftRangeCell(ranges = []) {
  let best = null;
  for (const range of ranges) {
    if (!range) continue;
    const cell = { r: Number(range.r0), c: Number(range.c0) };
    if (!Number.isFinite(cell.r) || !Number.isFinite(cell.c)) continue;
    if (!best || cell.r < best.r || (cell.r === best.r && cell.c < best.c)) best = cell;
  }
  return best;
}

export function scrollSpreadsheetCellIntoView(cell, scrollHost) {
  if (!cell) return;
  if (!scrollHost) {
    cell.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    return;
  }
  const hostRect = scrollHost.getBoundingClientRect();
  const cellRect = cell.getBoundingClientRect();
  const table = cell.closest("table");
  const thead = table?.querySelector("thead");
  const stickyHeader = thead && Array.from(thead.querySelectorAll("th"))
    .some((header) => getComputedStyle(header).position === "sticky");
  const topInset = stickyHeader ? thead.getBoundingClientRect().height : 0;
  const rowHeader = cell.parentElement?.querySelector("th");
  const rowHeaderStyle = rowHeader ? getComputedStyle(rowHeader) : null;
  const stickyRowHeader = rowHeaderStyle?.position === "sticky" && rowHeaderStyle?.left !== "auto";
  const leftInset = stickyRowHeader ? rowHeader.getBoundingClientRect().width : 0;
  const visibleTop = hostRect.top + topInset;
  const visibleLeft = hostRect.left + leftInset;
  if (cellRect.top < visibleTop) scrollHost.scrollTop += cellRect.top - visibleTop;
  else if (cellRect.bottom > hostRect.bottom) scrollHost.scrollTop += cellRect.bottom - hostRect.bottom;
  if (cellRect.left < visibleLeft) scrollHost.scrollLeft += cellRect.left - visibleLeft;
  else if (cellRect.right > hostRect.right) scrollHost.scrollLeft += cellRect.right - hostRect.right;
}

export async function writeTextToClipboard(text) {
  const value = String(text ?? "");
  if (navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
    await navigator.clipboard.writeText(value);
    return;
  }
  const ta = document.createElement("textarea");
  ta.value = value;
  ta.style.position = "fixed";
  ta.style.left = "-9999px";
  ta.style.top = "0";
  document.body.appendChild(ta);
  ta.focus();
  ta.select();
  document.execCommand("copy");
  ta.remove();
}

function isTypingTarget(target) {
  if (!target) return false;
  const selector = "input, textarea, select, option, button, [contenteditable='true']";
  return !!(
    target.closest
      ? target.closest(selector)
      : (target.matches && target.matches(selector))
  ) || !!target.isContentEditable;
}

function dataAttrName(key) {
  return String(key || "").replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
}

function cellSelectorFor(row, col, rowKey = "r", colKey = "c") {
  return `td[data-${dataAttrName(rowKey)}="${row}"][data-${dataAttrName(colKey)}="${col}"]`;
}

// A copy carries the number a cell holds, not the rounded text it shows: a cell
// that renders a formatted figure keeps the unrounded value in
// `data-copy-value`, and only a cell without one copies its text.
function cellText(cell) {
  return cell?.dataset?.copyValue ?? String(cell?.textContent ?? "").trim();
}

function buildTsvFromRange(container, range, getCellText = cellText, rowKey = "r", colKey = "c") {
  const rows = [];
  for (let r = range.r0; r <= range.r1; r++) {
    const row = [];
    for (let c = range.c0; c <= range.c1; c++) {
      row.push(getCellText(container.querySelector(cellSelectorFor(r, c, rowKey, colKey))));
    }
    rows.push(row.join("\t"));
  }
  return rows.join("\n");
}

export function wireSelectableTable(options = {}) {
  const container = options.container;
  if (!container || container.dataset.tableSelectionWired === "1") return null;
  container.dataset.tableSelectionWired = "1";

  const listenerCleanup = [];
  const listen = (target, type, handler, eventOptions) => {
    target.addEventListener(type, handler, eventOptions);
    listenerCleanup.push(() => target.removeEventListener(type, handler, eventOptions));
  };

  const selectedClass = options.selectedClass || "sel";
  const activeClass = options.activeClass || "active";
  const edgeClasses = options.edgeClasses && typeof options.edgeClasses === "object"
    ? {
        top: String(options.edgeClasses.top || ""),
        right: String(options.edgeClasses.right || ""),
        bottom: String(options.edgeClasses.bottom || ""),
        left: String(options.edgeClasses.left || ""),
      }
    : null;
  const edgeClassNames = edgeClasses
    ? [...new Set(Object.values(edgeClasses).filter(Boolean))]
    : [];
  const rowKey = options.rowKey || "r";
  const colKey = options.colKey || "c";
  const cellQuery = `td[data-${dataAttrName(rowKey)}][data-${dataAttrName(colKey)}]`;
  const rowHeaderSelector = String(options.rowHeaderSelector || "");
  const columnHeaderSelector = String(options.columnHeaderSelector || "");
  const getCellText = typeof options.getCellText === "function" ? options.getCellText : cellText;
  const isSelectableCell = typeof options.isSelectableCell === "function" ? options.isSelectableCell : () => true;
  const canStartPointerSelection = typeof options.canStartPointerSelection === "function"
    ? options.canStartPointerSelection
    : () => true;
  const canHandleKeyboardNavigation = typeof options.canHandleKeyboardNavigation === "function"
    ? options.canHandleKeyboardNavigation
    : () => options.canHandleKeyboardNavigation === true;
  const canStartLabelSelection = typeof options.canStartLabelSelection === "function"
    ? options.canStartLabelSelection
    : () => options.canStartLabelSelection === true;
  const getColumnHeaderIndex = typeof options.getColumnHeaderIndex === "function"
    ? options.getColumnHeaderIndex
    : (header) => Number(header?.dataset?.[colKey]);
  const getScrollHost = typeof options.scrollHost === "function"
    ? options.scrollHost
    : () => options.scrollHost || null;
  const onContextMenu = typeof options.onContextMenu === "function" ? options.onContextMenu : null;
  const onSelectionChange = typeof options.onSelectionChange === "function"
    ? options.onSelectionChange
    : null;
  const exclusiveAcrossTables = options.exclusiveAcrossTables === true;
  const state = {
    activeCell: null,
    ranges: [],
    drag: null,
    isActive: false,
    anchorCell: null,
    exclusiveAcrossTables,
    clearSelection: null,
    moveSelection: null,
  };

  const markActive = () => {
    const previous = activeSelectableTable;
    if (
      exclusiveAcrossTables &&
      previous &&
      previous !== state &&
      previous.exclusiveAcrossTables &&
      typeof previous.clearSelection === "function"
    ) {
      previous.clearSelection();
    }
    state.isActive = true;
    activeSelectableTable = state;
  };

  function rcFromCell(cell) {
    const r = Number(cell?.dataset?.[rowKey]);
    const c = Number(cell?.dataset?.[colKey]);
    if (!Number.isInteger(r) || !Number.isInteger(c)) return null;
    return { r, c };
  }

  function clearClasses() {
    container.querySelectorAll(`td.${selectedClass}`).forEach((el) => el.classList.remove(selectedClass));
    container.querySelectorAll(`td.${activeClass}`).forEach((el) => el.classList.remove(activeClass));
    edgeClassNames.forEach((className) => {
      container.querySelectorAll(`td.${className}`).forEach((el) => el.classList.remove(className));
    });
  }

  function applyClasses() {
    clearClasses();
    for (const range of state.ranges) {
      for (let r = range.r0; r <= range.r1; r++) {
        for (let c = range.c0; c <= range.c1; c++) {
          const cell = container.querySelector(cellSelectorFor(r, c, rowKey, colKey));
          if (!cell || !isSelectableCell(cell)) continue;
          cell.classList.add(selectedClass);
          if (!edgeClasses) continue;
          if (r === range.r0 && edgeClasses.top) cell.classList.add(edgeClasses.top);
          if (c === range.c1 && edgeClasses.right) cell.classList.add(edgeClasses.right);
          if (r === range.r1 && edgeClasses.bottom) cell.classList.add(edgeClasses.bottom);
          if (c === range.c0 && edgeClasses.left) cell.classList.add(edgeClasses.left);
        }
      }
    }
    if (state.activeCell) {
      container.querySelector(cellSelectorFor(state.activeCell.r, state.activeCell.c, rowKey, colKey))?.classList.add(activeClass);
    }
    if (onSelectionChange) {
      onSelectionChange({
        activeCell: state.activeCell ? { ...state.activeCell } : null,
        ranges: state.ranges.map((range) => ({ ...range })),
      });
    }
  }

  function clearSelection() {
    state.activeCell = null;
    state.anchorCell = null;
    state.ranges = [];
    state.drag = null;
    state.isActive = false;
    if (activeSelectableTable === state) activeSelectableTable = null;
    applyClasses();
  }

  state.clearSelection = clearSelection;

  function selectCell(cell, append = false) {
    const rc = rcFromCell(cell);
    if (!rc) return false;
    state.activeCell = rc;
    state.anchorCell = rc;
    markActive();
    if (!append) state.ranges = [];
    state.ranges.push(normalizeRange(rc.r, rc.c, rc.r, rc.c));
    applyClasses();
    return true;
  }

  function isCellInSelection(cell) {
    const rc = rcFromCell(cell);
    if (!rc) return false;
    return state.ranges.some((range) => (
      rc.r >= range.r0 && rc.r <= range.r1 && rc.c >= range.c0 && rc.c <= range.c1
    ));
  }

  function selectablePositions() {
    return Array.from(container.querySelectorAll(cellQuery))
      .filter((cell) => isSelectableCell(cell))
      .map((cell) => rcFromCell(cell))
      .filter(Boolean);
  }

  function selectRow(row) {
    const rowIndex = Number(row);
    if (!Number.isInteger(rowIndex)) return false;
    const positions = selectablePositions().filter((position) => position.r === rowIndex);
    if (!positions.length) return false;
    const minCol = Math.min(...positions.map((position) => position.c));
    const maxCol = Math.max(...positions.map((position) => position.c));
    const anchor = { r: rowIndex, c: minCol };
    state.activeCell = { ...anchor };
    state.anchorCell = { ...anchor };
    state.ranges = [normalizeRange(rowIndex, minCol, rowIndex, maxCol)];
    markActive();
    applyClasses();
    return true;
  }

  function selectColumn(col) {
    const colIndex = Number(col);
    if (!Number.isInteger(colIndex)) return false;
    const positions = selectablePositions().filter((position) => position.c === colIndex);
    if (!positions.length) return false;
    const minRow = Math.min(...positions.map((position) => position.r));
    const maxRow = Math.max(...positions.map((position) => position.r));
    const anchor = { r: minRow, c: colIndex };
    state.activeCell = { ...anchor };
    state.anchorCell = { ...anchor };
    state.ranges = [normalizeRange(minRow, colIndex, maxRow, colIndex)];
    markActive();
    applyClasses();
    return true;
  }

  async function copySelection() {
    const ranges = state.ranges.length
      ? state.ranges
      : (state.activeCell ? [normalizeRange(state.activeCell.r, state.activeCell.c, state.activeCell.r, state.activeCell.c)] : []);
    if (!ranges.length) return false;
    const topLeft = ranges.length > 1 ? getTopLeftRangeCell(ranges) : null;
    const text = ranges.length === 1
      ? buildTsvFromRange(container, ranges[0], getCellText, rowKey, colKey)
      : getCellText(topLeft ? container.querySelector(cellSelectorFor(topLeft.r, topLeft.c, rowKey, colKey)) : null);
    await writeTextToClipboard(text);
    return true;
  }

  function selectableBounds() {
    const positions = selectablePositions();
    if (!positions.length) return null;
    return {
      minRow: Math.min(...positions.map((position) => position.r)),
      maxRow: Math.max(...positions.map((position) => position.r)),
      minCol: Math.min(...positions.map((position) => position.c)),
      maxCol: Math.max(...positions.map((position) => position.c)),
    };
  }

  function scrollActiveCellIntoView() {
    if (!state.activeCell) return;
    const cell = container.querySelector(cellSelectorFor(state.activeCell.r, state.activeCell.c, rowKey, colKey));
    if (!cell) return;
    scrollSpreadsheetCellIntoView(cell, getScrollHost());
  }

  function moveSelection(deltaRow, deltaCol, settings = {}) {
    if (activeSelectableTable !== state || !state.isActive || !state.activeCell) return false;
    const rowDirection = Math.sign(Number(deltaRow) || 0);
    const colDirection = Math.sign(Number(deltaCol) || 0);
    if (!rowDirection && !colDirection) return false;
    const limit = selectableBounds();
    if (!limit) return false;
    const jump = settings.jump === true;

    if (settings.extend === true) {
      const anchor = state.anchorCell || state.activeCell;
      const active = { ...state.activeCell };
      if (rowDirection < 0) active.r = jump ? limit.minRow : Math.max(limit.minRow, active.r - 1);
      if (rowDirection > 0) active.r = jump ? limit.maxRow : Math.min(limit.maxRow, active.r + 1);
      if (colDirection < 0) active.c = jump ? limit.minCol : Math.max(limit.minCol, active.c - 1);
      if (colDirection > 0) active.c = jump ? limit.maxCol : Math.min(limit.maxCol, active.c + 1);
      if (active.r === state.activeCell.r && active.c === state.activeCell.c) return false;
      state.activeCell = active;
      state.anchorCell = { ...anchor };
      state.ranges = [normalizeRange(anchor.r, anchor.c, active.r, active.c)];
      applyClasses();
      scrollActiveCellIntoView();
      return true;
    }

    const origin = state.anchorCell || state.activeCell;
    const active = { ...origin };
    if (rowDirection < 0) active.r = jump ? limit.minRow : Math.max(limit.minRow, active.r - 1);
    if (rowDirection > 0) active.r = jump ? limit.maxRow : Math.min(limit.maxRow, active.r + 1);
    if (colDirection < 0) active.c = jump ? limit.minCol : Math.max(limit.minCol, active.c - 1);
    if (colDirection > 0) active.c = jump ? limit.maxCol : Math.min(limit.maxCol, active.c + 1);
    const hasRange = state.ranges.length !== 1
      || state.ranges[0].r0 !== state.ranges[0].r1
      || state.ranges[0].c0 !== state.ranges[0].c1;
    if (!hasRange && active.r === origin.r && active.c === origin.c) return false;
    state.activeCell = active;
    state.anchorCell = { ...active };
    state.ranges = [normalizeRange(active.r, active.c, active.r, active.c)];
    applyClasses();
    scrollActiveCellIntoView();
    return true;
  }

  state.moveSelection = moveSelection;

  listen(container, "mousedown", (event) => {
    if (event.button !== 0 || isTypingTarget(event.target)) return;
    if (!canStartPointerSelection(event)) return;
    const cell = event.target?.closest?.(cellQuery);
    if (!cell || !container.contains(cell) || !isSelectableCell(cell)) return;
    const rc = rcFromCell(cell);
    if (!rc) return;
    event.preventDefault();
    const append = !!(event.ctrlKey || event.metaKey);
    if (!append) state.ranges = [];
    state.activeCell = rc;
    state.anchorCell = rc;
    markActive();
    state.drag = { anchor: rc };
    state.ranges.push(normalizeRange(rc.r, rc.c, rc.r, rc.c));
    applyClasses();
  });

  listen(container, "mouseover", (event) => {
    if (!state.drag) return;
    const cell = event.target?.closest?.(cellQuery);
    if (!cell || !container.contains(cell) || !isSelectableCell(cell)) return;
    const rc = rcFromCell(cell);
    if (!rc) return;
    const lastIdx = state.ranges.length - 1;
    if (lastIdx < 0) return;
    state.activeCell = rc;
    state.ranges[lastIdx] = normalizeRange(state.drag.anchor.r, state.drag.anchor.c, rc.r, rc.c);
    applyClasses();
  });

  listen(container, "contextmenu", (event) => {
    const cell = event.target?.closest?.(cellQuery);
    if (!cell || !container.contains(cell) || !isSelectableCell(cell)) return;
    markActive();
    if (!isCellInSelection(cell)) selectCell(cell, false);
    if (onContextMenu) onContextMenu(event, cell, { copySelection, state });
  });

  listen(container, "click", (event) => {
    if (isTypingTarget(event.target) || !canStartLabelSelection(event)) return;
    const rowHeader = rowHeaderSelector ? event.target?.closest?.(rowHeaderSelector) : null;
    if (rowHeader && container.contains(rowHeader)) {
      const row = rowHeader.closest("tr");
      const rowCell = row
        ? Array.from(row.querySelectorAll(cellQuery)).find((cell) => isSelectableCell(cell))
        : null;
      const position = rcFromCell(rowCell);
      if (!position || !selectRow(position.r)) return;
      event.preventDefault();
      return;
    }
    const columnHeader = columnHeaderSelector ? event.target?.closest?.(columnHeaderSelector) : null;
    if (!columnHeader || !container.contains(columnHeader)) return;
    if (!selectColumn(getColumnHeaderIndex(columnHeader))) return;
    event.preventDefault();
  });

  listen(document, "mouseup", () => {
    state.drag = null;
  });

  listen(document, "keydown", (event) => {
    if (isTypingTarget(event.target)) return;
    if (event.key === "Escape" && activeSelectableTable === state && state.isActive) {
      clearSelection();
      event.preventDefault();
      return;
    }
    const movement = {
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
    }[event.key];
    if (
      movement
      && !event.altKey
      && activeSelectableTable === state
      && state.isActive
      && canHandleKeyboardNavigation(event)
    ) {
      moveSelection(movement[0], movement[1], {
        extend: event.shiftKey,
        jump: event.ctrlKey || event.metaKey,
      });
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (!(event.ctrlKey || event.metaKey) || String(event.key || "").toLowerCase() !== "c") return;
    if (activeSelectableTable !== state || !state.isActive || (!state.ranges.length && !state.activeCell)) return;
    event.preventDefault();
    void copySelection();
  });

  function destroy() {
    while (listenerCleanup.length) listenerCleanup.pop()?.();
    if (activeSelectableTable === state) activeSelectableTable = null;
    state.activeCell = null;
    state.anchorCell = null;
    state.ranges = [];
    state.drag = null;
    state.isActive = false;
    delete container.dataset.tableSelectionWired;
  }

  return {
    copySelection,
    selectCell,
    clearSelection,
    moveSelection,
    selectColumn,
    selectRow,
    state,
    applyClasses,
    destroy,
  };
}
