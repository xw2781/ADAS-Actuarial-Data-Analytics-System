import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const source = await readFile(
  new URL("../ui/shared/components/formula_bar/formula_bar_excel_link.js", import.meta.url),
  "utf8",
);
const styles = await readFile(
  new URL("../ui/shared/components/formula_bar/formula_bar.css", import.meta.url),
  "utf8",
);

const asModule = (text) => `data:text/javascript;base64,${Buffer.from(text).toString("base64")}`;
const replaceImport = (text, path, replacement) => {
  const specifier = new RegExp(`"${path.replace(/[.\\/]/gu, "\\$&")}(\\?v=[^"]*)?"`, "u");
  if (!specifier.test(text)) throw new Error(`${path} import not found`);
  return text.replace(specifier, JSON.stringify(replacement));
};

// The reference parser is the real one, so the test reads a formula exactly as
// the app does. The Excel bridge and the tooltip are stood in for: one records
// the call the button makes, the other only needs to not touch a real document.
const opened = [];
let openResult = { ok: true };
const excelApiStub = asModule(`
  export async function openExcelWorkbook(bookPath, sheet, cell) {
    globalThis.__excelOpenCalls.push({ bookPath, sheet, cell });
    return globalThis.__excelOpenResult;
  }
`);
const tooltipStub = asModule(`
  export function attachArcrhoTooltip(target, textProvider) {
    globalThis.__tooltipTexts.set(target, textProvider);
  }
`);
globalThis.__excelOpenCalls = opened;
globalThis.__tooltipTexts = new Map();
Object.defineProperty(globalThis, "__excelOpenResult", { get: () => openResult });

const patched = [
  ["/ui/shared/integrations/excel_reference.js", new URL(
    "../ui/shared/integrations/excel_reference.js",
    import.meta.url,
  ).href],
  ["/ui/shared/integrations/excel_api.js", excelApiStub],
  ["/ui/shared/components/tooltip/tooltip.js", tooltipStub],
].reduce((text, [path, replacement]) => replaceImport(text, path, replacement), source);
const excelLink = await import(asModule(patched));

class FakeButton {
  constructor() {
    this.attributes = new Map();
    this.listeners = new Map();
    this.className = "";
    this.hidden = false;
    this.disabled = false;
    this.classList = {
      toggle: (name, force) => {
        const values = new Set(this.className.split(/\s+/u).filter(Boolean));
        if (force) values.add(name);
        else values.delete(name);
        this.className = Array.from(values).join(" ");
      },
    };
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  removeAttribute(name) {
    this.attributes.delete(name);
  }

  addEventListener(type, listener) {
    this.listeners.set(type, listener);
  }

  dispatch(type) {
    let defaultPrevented = false;
    let propagationStopped = false;
    this.listeners.get(type)?.({
      preventDefault: () => { defaultPrevented = true; },
      stopPropagation: () => { propagationStopped = true; },
    });
    return { defaultPrevented, propagationStopped };
  }
}

function setup() {
  const statuses = [];
  const documentRef = { createElement: () => new FakeButton() };
  const button = excelLink.createFormulaBarExcelLinkButton({
    documentRef,
    onStatus: (message) => statuses.push(message),
  });
  return { button, statuses };
}

const RANGE_FORMULA = "='C:\\Data\\[Book.xlsx]Sheet 1'!A1:B2";

test("a formula's first workbook reference is what the button targets", () => {
  const target = excelLink.excelLinkTargetFromFormula(RANGE_FORMULA);
  assert.deepEqual(target, {
    bookPath: "C:\\Data\\Book.xlsx",
    workbookName: "Book.xlsx",
    sheet: "Sheet 1",
    address: "A1:B2",
  });
  // A single cell keeps a single address rather than naming itself twice.
  assert.equal(
    excelLink.excelLinkTargetFromFormula("='C:\\Data\\[Book.xlsx]Sheet1'!$B$4").address,
    "B4",
  );
  // Two workbooks in one formula: the first is offered, and the tooltip says so.
  const mixed = excelLink.excelLinkTargetFromFormula(
    "='C:\\A\\[One.xlsx]S1'!A1 * 'C:\\B\\[Two.xlsx]S2'!C3",
  );
  assert.equal(mixed.workbookName, "One.xlsx");
  assert.equal(
    excelLink.excelLinkTooltipText(mixed),
    "Open One.xlsx in Excel and select S1!A1",
  );
});

test("a formula with no workbook reference has no target", () => {
  assert.equal(excelLink.excelLinkTargetFromFormula('= "Simple - 2" * 1.05'), null);
  assert.equal(excelLink.excelLinkTargetFromFormula("=[Accounting Cutoff][-1]"), null);
  assert.equal(excelLink.excelLinkTargetFromFormula(""), null);
  assert.equal(excelLink.excelLinkTooltipText(null), "");
});

test("the button shows only while the bar carries a workbook formula", () => {
  const { button } = setup();
  assert.equal(button.el.hidden, true);
  assert.equal(button.update(RANGE_FORMULA), true);
  assert.equal(button.el.hidden, false);
  assert.equal(button.update("= 1.05"), false);
  assert.equal(button.el.hidden, true);
});

test("pressing the button opens the workbook at the range and keeps the input's focus", async () => {
  opened.length = 0;
  openResult = { ok: true };
  const { button, statuses } = setup();
  button.update(RANGE_FORMULA);
  // A press that took focus would blur the formula input, which commits.
  assert.equal(button.el.dispatch("mousedown").defaultPrevented, true);
  await button.open();
  assert.deepEqual(opened, [{ bookPath: "C:\\Data\\Book.xlsx", sheet: "Sheet 1", cell: "A1:B2" }]);
  assert.deepEqual(statuses, [
    "Opening Book.xlsx in Excel...",
    "Selected Sheet 1!A1:B2 in Book.xlsx.",
  ]);
});

test("a workbook that cannot be opened reports why", async () => {
  opened.length = 0;
  openResult = { ok: false, error: "File not found: C:\\Data\\Book.xlsx" };
  const { button, statuses } = setup();
  button.update(RANGE_FORMULA);
  assert.equal(await button.open(), false);
  assert.equal(statuses.at(-1), "File not found: C:\\Data\\Book.xlsx");
  // Nothing to open means nothing is attempted and nothing is said.
  button.update("= 1.05");
  const before = statuses.length;
  assert.equal(await button.open(), false);
  assert.equal(statuses.length, before);
});

test("the button wears the link colour and the shared external-link drawing", () => {
  assert.match(styles, /\.arFormulaBarExcelLink\s*\{[^}]*color:\s*var\(--ar-spreadsheet-excel-link-border, #217346\)/su);
  // Artwork stays a file, applied as a mask so one drawing serves every state.
  assert.match(styles, /mask:\s*url\("\.\.\/\.\.\/icons\/library\/external-link\.svg\?v=[^"]+"\)/u);
  assert.match(styles, /\.arFormulaBarExcelLink\[hidden\]\s*\{\s*display:\s*none/su);
});

test("both formula bars build the one shared button", async () => {
  const bars = [
    ["formula_hover.js", "../ui/shared/components/formula_hover/formula_hover.js"],
    ["summary_formula_bar.js", "../ui/method_pages/dfm/ratios_summary/summary_formula_bar.js"],
  ];
  for (const [name, path] of bars) {
    const text = await readFile(new URL(path, import.meta.url), "utf8");
    assert.match(text, /formula_bar_excel_link\.js\?v=/u, name);
    assert.match(text, /createFormulaBarExcelLinkButton\(/u, name);
    if (name !== "summary_formula_bar.js") continue;
    // The DFM bar points the button at the raw input rather than the rendered
    // display, because a reference can sit inside a ROUND the rendering hides.
    assert.match(text, /summaryExcelLink\?\.update\(input\.value\)/u, name);
  }
});
