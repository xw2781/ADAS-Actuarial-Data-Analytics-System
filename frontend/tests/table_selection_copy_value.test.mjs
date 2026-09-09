import assert from "node:assert/strict";
import test from "node:test";

// A copy takes the figure a cell holds, not the rounded text it prints: a
// cell carrying `data-copy-value` copies that, one without copies its text.

function fakeCell(r, c, text, copyValue) {
  const dataset = { r: String(r), c: String(c) };
  if (copyValue !== undefined) dataset.copyValue = copyValue;
  const classes = new Set();
  return {
    dataset,
    textContent: text,
    classList: {
      add: (name) => classes.add(name),
      remove: (name) => classes.delete(name),
      contains: (name) => classes.has(name),
    },
    closest: () => null,
  };
}

function fakeContainer(cells) {
  return {
    dataset: {},
    addEventListener() {},
    removeEventListener() {},
    querySelectorAll(selector) {
      if (selector.startsWith("td.")) return cells.filter((cell) => cell.classList.contains(selector.slice(3)));
      return cells;
    },
    querySelector(selector) {
      const match = /td\[data-r="(\d+)"\]\[data-c="(\d+)"\]/u.exec(selector);
      if (!match) return null;
      return cells.find((cell) => cell.dataset.r === match[1] && cell.dataset.c === match[2]) ?? null;
    },
  };
}

// Node defines `navigator` as a getter on globalThis, so both globals are
// swapped through property descriptors and restored afterwards.
function swapGlobal(name, value) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { value, configurable: true, writable: true });
  return () => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else delete globalThis[name];
  };
}

async function withFakeDom(run) {
  let written = null;
  const restore = [
    swapGlobal("document", { addEventListener() {}, removeEventListener() {} }),
    swapGlobal("navigator", { clipboard: { writeText: async (text) => { written = text; } } }),
  ];
  try {
    return await run(() => written);
  } finally {
    restore.forEach((fn) => fn());
  }
}

test("a selectable table copies data-copy-value before the printed text", async () => {
  await withFakeDom(async (clipboard) => {
    const { wireSelectableTable } = await import("../ui/shared/components/spreadsheet/table_selection.js");
    const cells = [
      fakeCell(0, 0, "1.0523", "1.0523456789012"),
      fakeCell(0, 1, "1.0100", "1.0099999999999"),
      fakeCell(1, 0, "1.0000", "1"),
      fakeCell(1, 1, "N/A"),
    ];
    const api = wireSelectableTable({ container: fakeContainer(cells) });

    assert.equal(api.selectCell(cells[0]), true);
    assert.equal(await api.copySelection(), true);
    assert.equal(clipboard(), "1.0523456789012");

    assert.equal(api.moveSelection(1, 1, { extend: true }), true);
    assert.equal(await api.copySelection(), true);
    assert.equal(clipboard(), "1.0523456789012\t1.0099999999999\n1\tN/A");
  });
});
