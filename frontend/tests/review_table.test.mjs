import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  filterReviewTableRows,
  normalizeReviewTableColumns,
  normalizeReviewTableOptions,
  normalizeReviewTableRows,
  selectedReviewTableRowIds,
  summarizeReviewTableSelection,
} from "../ui/shared/components/review_table/review_table.js";

const frontendRoot = new URL("../", import.meta.url);

async function source(relativePath) {
  return readFile(new URL(relativePath, frontendRoot), "utf8");
}

test("review-table normalization preserves timestamps as text and keeps markup inert", () => {
  const columns = normalizeReviewTableColumns([
    { key: "name", label: "Dataset Or Method" },
    { key: "resq_time", label: "ResQ Timestamp" },
    { key: "status", label: "Status" },
  ]);
  const rows = normalizeReviewTableRows([
    {
      id: "dataset:paid",
      cells: {
        name: "Paid <img src=x onerror=alert(1)>",
        resq_time: "2026-08-12T10:30:00-04:00",
        status: { text: "ResQ Newer", tone: "newer" },
      },
    },
    {
      id: "method:dfm",
      disabled: true,
      selected: true,
      cells: { name: "DFM", resq_time: "", status: "Unsupported" },
    },
  ], columns);

  assert.equal(rows[0].cells[0].text, "Paid <img src=x onerror=alert(1)>");
  assert.equal(rows[0].cells[1].text, "2026-08-12T10:30:00-04:00");
  assert.equal(rows[0].cells[2].tone, "newer");
  assert.equal(rows[0].selected, true);
  assert.equal(rows[1].disabled, true);
  assert.equal(rows[1].selected, false);
});

test("review-table selection summaries respect disabled rows and the filtered view", () => {
  const columns = normalizeReviewTableColumns([{ key: "name", label: "Name" }]);
  const rows = normalizeReviewTableRows([
    { id: "a", selected: true, cells: { name: "Paid Loss" } },
    { id: "b", selected: false, cells: { name: "Case Reserve" } },
    { id: "c", disabled: true, cells: { name: "Unsupported Method" } },
  ], columns);
  const selected = new Set(["a", "c"]);
  const visible = filterReviewTableRows(rows, "loss");
  const summary = summarizeReviewTableSelection(rows, selected, visible);

  assert.deepEqual(selectedReviewTableRowIds(rows, selected), ["a"]);
  assert.equal(summary.actionableCount, 2);
  assert.equal(summary.selectedCount, 1);
  assert.equal(summary.visibleCount, 1);
  assert.equal(summary.allVisibleSelected, true);
  assert.equal(summary.someVisibleSelected, false);
});

test("review-table rows require unique stable identifiers", () => {
  const columns = normalizeReviewTableColumns([{ key: "name", label: "Name" }]);
  assert.throws(
    () => normalizeReviewTableRows([{ cells: { name: "Missing id" } }], columns),
    /requires a stable id/u,
  );
  assert.throws(
    () => normalizeReviewTableRows([
      { id: "same", cells: { name: "One" } },
      { id: "same", cells: { name: "Two" } },
    ], columns),
    /duplicated/u,
  );
});

test("review-table columns carry the pi-table width fields the grid sizes from", () => {
  const columns = normalizeReviewTableColumns([
    { key: "name", label: "Dataset Or Method", width: 210, minWidth: 90, maxAutoWidth: 320 },
    { key: "status", label: "Status" },
    { key: "note", label: "Note", width: "0", max_auto_width: "180" },
  ]);

  assert.deepEqual(columns[0], {
    key: "name",
    label: "Dataset Or Method",
    align: "left",
    width: 210,
    minWidth: 90,
    maxAutoWidth: 320,
  });
  // A column with no stated width opens at whatever its own content needs.
  assert.equal(columns[1].width, 0);
  assert.equal(columns[1].maxAutoWidth, 0);
  // Zero and negative widths mean "size me", not "collapse me".
  assert.equal(columns[2].width, 0);
  assert.equal(columns[2].maxAutoWidth, 180);
});

test("the review grid is the Project Instance dataset table, minus grouping", async () => {
  const [view, styles, sharedTable, projectInstanceStyles, projectInstancePage] = await Promise.all([
    source("ui/shared/components/review_table/review_table_view.js"),
    source("ui/shared/components/review_table/review_table.css"),
    source("ui/shared/styles/pi_table.css"),
    source("ui/project_instance/project_instance.css"),
    source("ui/project_instance/project_instance.html"),
  ]);

  // One copy of the table's look: the Project Instance page reads it from the
  // shared sheet instead of declaring its own.
  assert.match(projectInstancePage, /shared\/styles\/pi_table\.css\?v=20260819a/u);
  assert.doesNotMatch(projectInstanceStyles, /^\.pi-table/mu);
  assert.match(sharedTable, /^\.pi-table \{/mu);
  assert.match(sharedTable, /^\.pi-table-header-cell \{/mu);
  assert.match(sharedTable, /^\.pi-table-col-resizer \{/mu);
  assert.match(sharedTable, /^\.pi-table-filter-popover \{/mu);
  // `--border` keeps one declaration; the Project Instance page reads it too.
  assert.match(sharedTable, /--border:\s*#d9dee8/u);
  assert.doesNotMatch(projectInstanceStyles, /--border:\s*#/u);

  // The review grid renders that markup: a colgroup of explicit widths, a
  // sticky header cell with sort, filter, and resize affordances, and rows the
  // shared selection rules paint through `data-record-key`.
  assert.match(view, /"pi-table-wrap reviewTableFrame"/u);
  assert.match(view, /"pi-table-surface reviewTableSurface"/u);
  assert.match(view, /element\(doc, "table", "pi-table"\)/u);
  assert.match(view, /col\.dataset\.colKey = column\.key/u);
  assert.match(view, /"pi-table-header-cell"/u);
  assert.match(view, /"pi-table-col-label"/u);
  assert.match(view, /"pi-table-filter-btn"/u);
  assert.match(view, /"pi-table-col-resizer"/u);
  assert.match(view, /"pi-table-cell-text"/u);
  assert.match(view, /tr\.dataset\.recordKey = row\.id/u);
  assert.match(view, /table\.style\.minWidth = total/u);
  // Grouping is the one dataset-table feature a one-off review has no use for.
  assert.doesNotMatch(view, /pi-table-group/u);
  assert.doesNotMatch(styles, /dataset-group-status|has-groups/u);
});

test("ticking a review row is the only kind of selection the grid shows", async () => {
  const [view, styles, sharedTable] = await Promise.all([
    source("ui/shared/components/review_table/review_table_view.js"),
    source("ui/shared/components/review_table/review_table.css"),
    source("ui/shared/styles/pi_table.css"),
  ]);

  // A click toggles the row it lands on; Shift-click paints the range from the
  // anchor with the anchor's new state.
  assert.match(view, /setRowTicked\(row, !selectedIds\.has\(row\.id\)\)/u);
  assert.match(view, /const ticked = selectedIds\.has\(anchorId\)/u);
  assert.match(view, /for \(let index = from; index <= to; index \+= 1\) setRowTicked\(visibleRows\[index\], ticked\)/u);
  // A ticked row wears the shared pi-table highlight, so there is never a
  // highlighted row that will not be accepted.
  assert.match(view, /tr\.classList\.toggle\("selected", ticked\)/u);
  assert.match(view, /box\.checked = ticked/u);
  // A disabled row can be neither clicked nor swept into a range.
  assert.match(view, /if \(row\.disabled\) return;/u);

  // The dataset table's left bar marks the row Enter would act on. A review
  // has no such target, so the review frame drops the bar - both the solid one
  // and the hollow multi-selection one - while the dataset table keeps them.
  const barOverride = styles.match(
    /\.reviewTableFrame \.pi-table tbody tr\[data-record-key\]\.selected td:first-child,\s*\.reviewTableFrame \.pi-table tbody tr\[data-record-key\]\.selected\.multi:not\(\.active\) td:first-child \{([^}]*)\}/su,
  );
  assert.ok(barOverride, "the review frame overrides both first-cell selection rules");
  assert.ok(!/inset 3px/su.test(barOverride[1]), "no solid left bar");
  assert.match(barOverride[1], /background-image: none;/u);
  assert.match(sharedTable, /box-shadow: inset 3px 0 0 #2474d8/u);

  // Dragging across rows ticks them, so it must not also select their text.
  assert.match(
    styles,
    /\.reviewTableFrame\.pi-table-wrap \{[^}]*user-select: none;/su,
  );
});

test("a payload's ASCII direction arrow is drawn rather than typed", async () => {
  const [view, styles] = await Promise.all([
    source("ui/shared/components/review_table/review_table_view.js"),
    source("ui/shared/components/review_table/review_table.css"),
  ]);

  // "ArcRho -> ResQ" reaches the grid as plain text because a Python producer
  // can only write a string; the grid paints the token as a real arrow.
  assert.match(view, /const ARROW_TOKEN = " -> ";/u);
  assert.match(view, /if \(index > 0\) node\.appendChild\(arrowIcon\(doc\)\)/u);
  // Only the spaced token counts, so "a->b" stays exactly as written.
  assert.doesNotMatch(view, /split\("->"\)/u);
  // The text around it stays in text nodes: wrapper spans would be clamped by
  // the cell's -webkit-box and ellipsised by the filter list's span rule.
  assert.match(view, /node\.appendChild\(doc\.createTextNode\(part\)\)/u);
  assert.doesNotMatch(view, /innerHTML/u);
  // Both places that show a cell's value draw it the same way.
  assert.match(view, /appendTextWithArrows\(doc, td\.appendChild\(/u);
  assert.match(view, /appendTextWithArrows\(doc, element\(doc, "span", ""\), option\.label\)/u);
  // The arrow is announced, and takes the cell's colour so it follows the tone.
  assert.match(view, /icon\.setAttribute\("aria-label", "to"\)/u);
  assert.match(styles, /\.reviewTableArrow \{[^}]*stroke: currentColor;/su);
});

test("a read-only review table drops the tick column and closes with one button, or two when it names a Cancel", async () => {
  const [component, view] = await Promise.all([
    source("ui/shared/components/review_table/review_table.js"),
    source("ui/shared/components/review_table/review_table_view.js"),
  ]);

  // `selectable: false` is the one switch; its default button label is Close.
  const report = normalizeReviewTableOptions({
    selectable: false,
    columns: [{ key: "name", label: "Name" }],
    rows: [{ id: "a", cells: { name: "Paid Loss" } }],
  });
  assert.equal(report.selectable, false);
  assert.equal(report.acceptLabel, "Close");
  assert.equal(report.cancellable, false);
  const review = normalizeReviewTableOptions({ rows: [{ id: "a", cells: { name: "Paid Loss" } }] });
  assert.equal(review.selectable, true);
  assert.equal(review.acceptLabel, "Accept Selected");
  assert.equal(review.cancellable, true);

  // A read-only table used as a confirmation - the ResQ export's timestamp
  // preview - names its own Cancel, and gets one beside the accept button.
  const confirmation = normalizeReviewTableOptions({
    selectable: false,
    acceptLabel: "Export to ResQ",
    cancelLabel: "Cancel",
    columns: [{ key: "name", label: "Name" }],
    rows: [{ id: "a", cells: { name: "Paid Loss" } }],
  });
  assert.equal(confirmation.selectable, false);
  assert.equal(confirmation.cancellable, true);
  assert.equal(confirmation.acceptLabel, "Export to ResQ");

  // The panel starts a report with nothing ticked, renders a Cancel button
  // only where there is something to cancel, and hands the grid the switch.
  assert.match(component, /new Set\(model\.selectable \? model\.rows\.filter/u);
  assert.match(component, /const cancelButton = model\.cancellable \? element\(/u);
  assert.match(component, /selectable: model\.selectable,/u);
  // The grid then draws no tick column or select-all, and neither a row click
  // nor the space bar ticks anything.
  assert.match(view, /const selectable = settings\.selectable !== false;/u);
  assert.match(view, /if \(selectable\) headRow\.appendChild\(buildSelectHeaderCell\(\)\)/u);
  assert.match(view, /if \(selectable && \(event\.key === " "/u);
});

test("shell UI automation wires asynchronous review-table open, status, and close commands", async () => {
  const [automation, index, uiShell, shellMessages, updateProgress, component, view, styles] = await Promise.all([
    source("ui/shell/ui_automation.js"),
    source("ui/index.html"),
    source("ui/shell/ui_shell.js"),
    source("ui/shell/shell_messages.js"),
    source("ui/shell/update_progress.js"),
    source("ui/shared/components/review_table/review_table.js"),
    source("ui/shared/components/review_table/review_table_view.js"),
    source("ui/shared/components/review_table/review_table.css"),
  ]);

  assert.match(automation, /ui\.reviewTableOpen/u);
  assert.match(automation, /ui\.reviewTableStatus/u);
  assert.match(automation, /ui\.reviewTableClose/u);
  assert.match(automation, /return \{ dialogId \}/u);
  assert.match(automation, /status: "completed"/u);
  assert.match(automation, /selectedRowIds/u);
  // Footer option checkboxes travel back to the automation caller with the
  // completion status, in both the modal and nested-window hosts.
  assert.match(automation, /optionStates/u);
  assert.match(component, /normalizeReviewTableChoices/u);
  assert.match(component, /optionStates/u);
  assert.match(styles, /\.reviewTableOption\b/u);
  assert.match(index, /review_table\/review_table\.css\?v=20260821b/u);
  // The modal host renders the same pi-table the nested window does, so it
  // loads the shared table sheet the grid is dressed by.
  assert.match(index, /shared\/styles\/pi_table\.css\?v=20260819a/u);
  assert.match(index, /ui_shell\.js\?v=20260908b/u);
  for (const consumer of [uiShell, shellMessages, updateProgress]) {
    assert.match(consumer, /ui_automation\.js\?v=20260904resize2/u);
  }
  // Payload text reaches the DOM as text, never as markup, in both modules.
  assert.match(view, /textContent = toText\(text\)/u);
  assert.doesNotMatch(component, /innerHTML/u);
  assert.doesNotMatch(view, /innerHTML/u);
  assert.match(component, /event\.key === "Escape"/u);
  assert.match(view, /Select all visible actions/u);
  assert.match(styles, /\.reviewTableResizeHandle/u);
});

test("a projectInstance-hosted review table runs as a nested pi-window", async () => {
  const [automation, piReviewTable, piMessages, piWindows, windowPage, windowScript, component, styles] = await Promise.all([
    source("ui/shell/ui_automation.js"),
    source("ui/project_instance/project_instance_review_table.js"),
    source("ui/project_instance/project_instance_messages.js"),
    source("ui/project_instance/project_instance_windows.js"),
    source("ui/shared/components/review_table/review_table_window.html"),
    source("ui/shared/components/review_table/review_table_window.js"),
    source("ui/shared/components/review_table/review_table.js"),
    source("ui/shared/components/review_table/review_table.css"),
  ]);

  // The shell routes host=projectInstance opens to the active Project Instance
  // tab and pins follow-up status/close commands to that owning tab.
  assert.match(automation, /reviewTableWantsProjectInstanceHost/u);
  assert.match(automation, /arcrho:automation-review-table-open/u);
  assert.match(automation, /arcrho:automation-review-table-status/u);
  assert.match(automation, /arcrho:automation-review-table-close/u);
  assert.match(automation, /reviewTableHostTabs/u);
  // Without an active Project Instance page the shell modal remains the host.
  assert.match(automation, /openAutomationReviewTable\(args\)/u);

  // The Project Instance page owns the dialog lifecycle as a nested window.
  assert.match(piMessages, /arcrho:automation-review-table-open/u);
  assert.match(piMessages, /arcrho:review-table-window-complete/u);
  assert.match(piReviewTable, /kind: "review_table"/u);
  assert.match(piReviewTable, /createFloatingContentWindow/u);
  assert.match(piReviewTable, /status: "pending", pending: true/u);
  assert.match(piReviewTable, /accepted: !!entry\.result\?\.accepted/u);
  // A user closing the window (X or minimized-tab close) resolves the review
  // as a cancelled completion instead of hanging the macro poll loop.
  assert.match(piReviewTable, /settleEntryIfWindowClosed/u);
  // Review windows are macro-session state, never part of the persisted
  // Project Instance window snapshot.
  assert.match(piWindows, /windowKind === "review_table"\) return null/u);

  // The nested-window page embeds the same shared panel the modal uses.
  assert.match(windowPage, /review_table\.css\?v=20260821b/u);
  assert.match(windowPage, /review_table_window\.js\?v=20260828f/u);
  // The nested window relays the footer option states with its completion.
  assert.match(windowScript, /optionStates/u);
  assert.match(piReviewTable, /optionStates/u);
  // The nested window is dressed by the shared pi-table sheet and the theme
  // sheets that already target those class names.
  assert.match(windowPage, /shared\/styles\/pi_table\.css\?v=20260819a/u);
  assert.match(windowScript, /createReviewTablePanel/u);
  assert.match(windowScript, /arcrho:review-table-window-ready/u);
  assert.match(component, /export function createReviewTablePanel/u);
  assert.match(styles, /\.reviewTableWindowHost/u);
});

test("an implicit active-window query with no open window reports None instead of an error", async () => {
  const piMessages = await source("ui/project_instance/project_instance_messages.js");
  // ArcRhoUI.project_instance.active_window() sends no windowId; when nothing
  // is open the page must reply ok with an empty windowId so the Python API
  // returns None, keeping the error only for explicit window lookups.
  assert.match(piMessages, /automationWindowArgsHaveExplicitTarget/u);
  assert.match(piMessages, /\{ ok: true, result: \{ windowId: "", id: "", connected: false, active: false \} \}/u);
  assert.match(piMessages, /Project Instance window was not found\./u);
});
