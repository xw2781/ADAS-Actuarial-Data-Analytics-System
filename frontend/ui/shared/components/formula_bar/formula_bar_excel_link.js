/*
===============================================================================
Formula Bar Excel Link
The button at the right-hand end of a formula bar whose formula reads from a
workbook. Pressing it brings that workbook up in Excel and selects the range the
formula names, so the number on screen can be read where it came from.

Shared by the Dataset Viewer's linked-cell editor and the DFM Ratios bar, which
is why the button owns the whole behaviour — what the formula points at, what
the tooltip says, and the press itself — and its host owns only where the status
line it reports through goes.
===============================================================================
*/
import { findExcelReferences } from "/ui/shared/integrations/excel_reference.js?v=20260715a";
import { openExcelWorkbook } from "/ui/shared/integrations/excel_api.js";
import { attachArcrhoTooltip } from "/ui/shared/components/tooltip/tooltip.js?v=20260812a";

/**
 * Where a formula's first workbook reference points, or null when it holds
 * none. A formula reading from two workbooks offers the first: the tooltip names
 * it, so which one the button opens is never a guess.
 */
export function excelLinkTargetFromFormula(formula) {
  const [reference] = findExcelReferences(formula);
  if (!reference?.bookPath) return null;
  const address = reference.endCell && reference.endCell !== reference.cell
    ? `${reference.cell}:${reference.endCell}`
    : reference.cell;
  return {
    bookPath: reference.bookPath,
    workbookName: reference.filename || reference.bookPath,
    sheet: reference.sheet,
    address,
  };
}

/** `Sheet1!A1:B4`, or just the address when the reference names no sheet. */
export function excelLinkRangeLabel(target) {
  if (!target?.address) return "";
  return target.sheet ? `${target.sheet}!${target.address}` : target.address;
}

export function excelLinkTooltipText(target) {
  if (!target) return "";
  return `Open ${target.workbookName} in Excel and select ${excelLinkRangeLabel(target)}`;
}

export function createFormulaBarExcelLinkButton(options = {}) {
  const documentRef = options.documentRef || document;
  const onStatus = typeof options.onStatus === "function" ? options.onStatus : () => {};

  let target = null;
  let busy = false;

  const button = documentRef.createElement("button");
  button.type = "button";
  button.className = "arFormulaBarExcelLink";
  button.hidden = true;
  button.setAttribute("aria-label", "Open the linked workbook in Excel");
  attachArcrhoTooltip(button, () => excelLinkTooltipText(target), { document: documentRef });

  // The press must not take focus off the formula input: a bar that commits on
  // blur would put the edit through on the way to opening the workbook.
  button.addEventListener("mousedown", (event) => event.preventDefault?.());
  button.addEventListener("click", (event) => {
    event.preventDefault?.();
    event.stopPropagation?.();
    void open();
  });

  function setBusy(value) {
    busy = !!value;
    button.disabled = busy;
    button.classList.toggle("is-busy", busy);
  }

  async function open() {
    if (!target || busy) return false;
    const where = excelLinkRangeLabel(target);
    setBusy(true);
    onStatus(`Opening ${target.workbookName} in Excel...`);
    let result;
    try {
      result = await openExcelWorkbook(target.bookPath, target.sheet, target.address);
    } catch (error) {
      result = { ok: false, error: String(error?.message || error) };
    }
    setBusy(false);
    if (result?.ok) {
      onStatus(`Selected ${where} in ${target.workbookName}.`);
      return true;
    }
    onStatus(result?.error || `${target.workbookName} could not be opened in Excel.`);
    return false;
  }

  /** Point the button at whatever the bar is showing now. */
  function update(formula) {
    target = excelLinkTargetFromFormula(formula);
    button.hidden = !target;
    return !!target;
  }

  return { el: button, open, update, getTarget: () => target };
}
