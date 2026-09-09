// Flight Deck - an always-on-top strip of one-press macro buttons that floats over the whole app.
// It owns nothing about how a macro runs: pressing a button hands the macro id back to the Macros
// window, which keeps one code path for context capture, review, and status reporting.

import { getHostApi, shell } from "../shell/shell_context.js?v=20260510a";
import { runMacroById } from "../macro/macro_window.js?v=20260908b";
import { createIconElement, iconForMacro, normalizeIcon } from "./flight_deck_icons.js?v=20260906a";
import { openFlightDeckButtonEditor } from "./flight_deck_editor.js?v=20260901b";
import { hideDeckTooltip as hideTooltip, showDeckTooltip } from "./flight_deck_tooltip.js?v=20260901a";

const API_BASE = window.location.origin;
const FRAGMENT_URL = "/ui/flight_deck/flight_deck.html?v=20260831a";
const LEGACY_STORAGE_KEY = "arcrho_flight_deck_v1";
const PREFS_VERSION = 1;
const HOST_WAIT_MS = 2000;
const EDGE_MARGIN = 8;
const DRAG_THRESHOLD_PX = 4;
const GHOST_OFFSET_PX = 12;
const RESULT_FLASH_MS = 1400;

let deck = null;
let deckGrip = null;
let deckSlots = null;
let deckHint = null;
let deckMenuBtn = null;
let deckCloseBtn = null;
let deckMenu = null;
let deckWired = false;
let fragmentPromise = null;
let macroIndex = new Map();
let macrosLoaded = false;
let configLoadPromise = null;

let config = {
  visible: false,
  orientation: "horizontal",
  position: null,
  buttons: [],
};

function isVertical() {
  return config.orientation === "vertical";
}

function newButtonId() {
  return `fdb_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

function normalizeButton(entry) {
  const macroId = String(entry?.macroId || "").trim();
  if (!macroId) return null;
  return {
    id: String(entry?.id || "").trim() || newButtonId(),
    macroId,
    label: String(entry?.label || "").trim(),
    icon: normalizeIcon(entry?.icon),
  };
}

/* ------------------------------------------------------------- preferences */

// The deck is a lasting per-PC setting, so it lives in a file of its own beside the other desktop
// preferences rather than in browser storage, which Clear Cache & Reload wipes. Browser storage is
// kept only as the fallback when the app runs outside the desktop host, and as the one-time source
// for a deck that was set up before the move.

function applyStoredConfig(saved) {
  if (!saved || typeof saved !== "object") return false;
  config = {
    visible: saved.visible === true,
    orientation: saved.orientation === "vertical" ? "vertical" : "horizontal",
    position: Number.isFinite(saved.position?.left) && Number.isFinite(saved.position?.top)
      ? { left: Number(saved.position.left), top: Number(saved.position.top) }
      : null,
    buttons: (Array.isArray(saved.buttons) ? saved.buttons : []).map(normalizeButton).filter(Boolean),
  };
  return true;
}

function readLegacyConfig() {
  try {
    return JSON.parse(localStorage.getItem(LEGACY_STORAGE_KEY) || "null");
  } catch {
    return null;
  }
}

// The desktop host is exposed by the time the shell boots in most launches, but not all of them.
function waitForHostApi() {
  const ready = getHostApi();
  if (ready) return Promise.resolve(ready);
  return new Promise((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      window.removeEventListener("adaHostReady", finish);
      clearTimeout(timer);
      resolve(getHostApi());
    };
    const timer = setTimeout(finish, HOST_WAIT_MS);
    window.addEventListener("adaHostReady", finish);
  });
}

async function loadConfig() {
  const host = await waitForHostApi();
  if (typeof host?.loadFlightDeckPreferences !== "function") {
    applyStoredConfig(readLegacyConfig());
    return;
  }
  let stored = null;
  try {
    const result = await host.loadFlightDeckPreferences();
    stored = result?.preferences || null;
  } catch {
    // An unreadable preferences file should not stop the shell from starting.
  }
  if (stored && Array.isArray(stored.buttons)) {
    applyStoredConfig(stored);
    return;
  }
  const legacy = readLegacyConfig();
  if (!applyStoredConfig(legacy)) return;
  saveConfig();
  try { localStorage.removeItem(LEGACY_STORAGE_KEY); } catch {}
}

function ensureConfigLoaded() {
  if (!configLoadPromise) configLoadPromise = loadConfig();
  return configLoadPromise;
}

function saveConfig() {
  const payload = { version: PREFS_VERSION, ...config };
  const host = getHostApi();
  if (typeof host?.saveFlightDeckPreferences === "function") {
    void Promise.resolve(host.saveFlightDeckPreferences(payload)).catch(() => {});
    return;
  }
  try {
    localStorage.setItem(LEGACY_STORAGE_KEY, JSON.stringify(payload));
  } catch {}
}

async function ensureDeckDom() {
  if (refreshDeckElements()) return true;
  if (!fragmentPromise) {
    fragmentPromise = fetch(FRAGMENT_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((markup) => {
        if (document.getElementById("flightDeck")) return;
        const template = document.createElement("template");
        template.innerHTML = markup.trim();
        document.body.appendChild(template.content);
      })
      .catch((err) => {
        fragmentPromise = null;
        throw err;
      });
  }
  try {
    await fragmentPromise;
  } catch (err) {
    shell.updateStatusBar?.(`Flight Deck failed to load: ${String(err?.message || err)}`, { tone: "error" });
    return false;
  }
  return refreshDeckElements();
}

function refreshDeckElements() {
  deck = document.getElementById("flightDeck");
  deckGrip = document.getElementById("flightDeckGrip");
  deckSlots = document.getElementById("flightDeckSlots");
  deckHint = document.getElementById("flightDeckHint");
  deckMenuBtn = document.getElementById("flightDeckMenuBtn");
  deckCloseBtn = document.getElementById("flightDeckCloseBtn");
  return !!deck;
}

/* ---------------------------------------------------------------- placement */

function placementBounds() {
  const statusbar = Number(shell.getStatusBarHeight?.() || 0);
  const width = deck?.offsetWidth || 0;
  const height = deck?.offsetHeight || 0;
  return {
    minLeft: EDGE_MARGIN,
    minTop: EDGE_MARGIN,
    maxLeft: Math.max(EDGE_MARGIN, window.innerWidth - width - EDGE_MARGIN),
    maxTop: Math.max(EDGE_MARGIN, window.innerHeight - statusbar - height - EDGE_MARGIN),
  };
}

function applyPosition(left, top) {
  if (!deck) return;
  const bounds = placementBounds();
  const nextLeft = Math.min(Math.max(Number(left) || 0, bounds.minLeft), bounds.maxLeft);
  const nextTop = Math.min(Math.max(Number(top) || 0, bounds.minTop), bounds.maxTop);
  deck.style.left = `${Math.round(nextLeft)}px`;
  deck.style.top = `${Math.round(nextTop)}px`;
  config.position = { left: Math.round(nextLeft), top: Math.round(nextTop) };
}

function restorePosition() {
  if (!deck) return;
  if (config.position) {
    applyPosition(config.position.left, config.position.top);
    return;
  }
  // First run: park the deck just under the tab strip, centred on the window.
  applyPosition((window.innerWidth - (deck.offsetWidth || 0)) / 2, 96);
}

function initDeckDrag() {
  if (!deckGrip || !deck) return;
  let drag = null;

  deckGrip.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const rect = deck.getBoundingClientRect();
    drag = { pointerId: event.pointerId, offsetX: event.clientX - rect.left, offsetY: event.clientY - rect.top };
    try { deckGrip.setPointerCapture(event.pointerId); } catch {}
    hideTooltip();
    closeDeckMenu();
    event.preventDefault();
  });

  deckGrip.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    applyPosition(event.clientX - drag.offsetX, event.clientY - drag.offsetY);
  });

  const stop = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    try { deckGrip.releasePointerCapture(event.pointerId); } catch {}
    drag = null;
    saveConfig();
  };

  deckGrip.addEventListener("pointerup", stop);
  deckGrip.addEventListener("pointercancel", stop);
}

/* ------------------------------------------------------------------ macros */

async function loadMacroIndex(force = false) {
  if (macrosLoaded && !force) return;
  try {
    const response = await fetch(`${API_BASE}/scripting/macros`);
    const loaded = await response.json();
    macroIndex = new Map((Array.isArray(loaded) ? loaded : []).map((macro) => [macro.id, macro]));
    macrosLoaded = true;
  } catch {
    // Leave whatever index we already had; buttons fall back to their stored label.
  }
  renderDeck();
}

function macroFor(button) {
  return macroIndex.get(button.macroId) || null;
}

function buttonLabel(button) {
  const macro = macroFor(button);
  return button.label || macro?.name || button.macroId;
}

function macroScopeList(macro) {
  const raw = macro?.scopes ?? macro?.scope ?? [];
  return (Array.isArray(raw) ? raw : [raw]).map((value) => String(value || "").trim()).filter(Boolean);
}

/* ------------------------------------------------------------------ render */

function renderDeck() {
  if (!deck || !deckSlots) return;
  deck.dataset.orientation = config.orientation;
  deck.setAttribute("aria-orientation", config.orientation);
  deckSlots.textContent = "";

  config.buttons.forEach((button) => {
    const macro = macroFor(button);
    const element = document.createElement("button");
    element.className = "flightDeckBtn";
    element.type = "button";
    element.dataset.buttonId = button.id;
    element.dataset.macroId = button.macroId;
    element.setAttribute("aria-label", buttonLabel(button));
    element.tabIndex = 0;
    if (macrosLoaded && !macro) element.classList.add("missing");
    element.appendChild(createIconElement(button.icon));
    deckSlots.appendChild(element);
  });

  if (deckHint) deckHint.hidden = config.buttons.length > 0;
}

function tooltipTextFor(element) {
  const button = findButton(element?.dataset?.buttonId);
  if (!button) return element?.dataset?.arcrhoTip || "";
  const macro = macroFor(button);
  if (macrosLoaded && !macro) return `${buttonLabel(button)} - this macro is no longer installed`;
  const scopes = macroScopeList(macro);
  return scopes.length ? `${buttonLabel(button)} (${scopes.join(", ")})` : buttonLabel(button);
}

function showTooltip(element, event) {
  showDeckTooltip(tooltipTextFor(element), event);
}

/* --------------------------------------------------------------- deck state */

function findButton(buttonId) {
  return config.buttons.find((button) => button.id === buttonId) || null;
}

function flashResult(buttonId, ok) {
  const element = deckSlots?.querySelector(`.flightDeckBtn[data-button-id="${CSS.escape(buttonId)}"]`);
  if (!element) return;
  element.classList.add(ok ? "succeeded" : "failed");
  setTimeout(() => element.classList.remove("succeeded", "failed"), RESULT_FLASH_MS);
}

async function runDeckButton(buttonId) {
  const button = findButton(buttonId);
  if (!button) return;
  const element = deckSlots?.querySelector(`.flightDeckBtn[data-button-id="${CSS.escape(buttonId)}"]`);
  if (element?.classList.contains("running")) return;
  element?.classList.remove("succeeded", "failed");
  element?.classList.add("running");
  hideTooltip();
  try {
    const result = await runMacroById(button.macroId);
    flashResult(buttonId, result?.ok !== false);
  } finally {
    element?.classList.remove("running");
  }
}

function removeDeckButton(buttonId) {
  const button = findButton(buttonId);
  if (!button) return;
  config.buttons = config.buttons.filter((item) => item.id !== buttonId);
  saveConfig();
  renderDeck();
  shell.updateStatusBar?.(`Removed ${buttonLabel(button)} from the Flight Deck.`);
}

function moveDeckButton(buttonId, beforeId) {
  const from = config.buttons.findIndex((button) => button.id === buttonId);
  if (from < 0) return;
  const [moved] = config.buttons.splice(from, 1);
  const to = beforeId ? config.buttons.findIndex((button) => button.id === beforeId) : -1;
  if (to < 0) config.buttons.push(moved);
  else config.buttons.splice(to, 0, moved);
  saveConfig();
  renderDeck();
}

function installedMacroList() {
  return [...macroIndex.values()].map((macro) => ({ id: macro.id, name: macro.name || macro.id }));
}

function editDeckButton(buttonId) {
  const button = findButton(buttonId);
  if (!button) return;
  openFlightDeckButtonEditor({
    title: "Edit Flight Deck Button",
    macroId: button.macroId,
    macros: installedMacroList(),
    label: buttonLabel(button),
    icon: button.icon,
    onApply: ({ macroId, label, icon }) => {
      button.macroId = macroId || button.macroId;
      const name = macroFor(button)?.name || "";
      button.label = label === name ? "" : label;
      button.icon = normalizeIcon(icon);
      saveConfig();
      renderDeck();
      shell.updateStatusBar?.(`Updated the ${buttonLabel(button)} button.`);
    },
  });
}

// The keyboard-only route to a new button, for anyone who would rather not drag one in.
function addDeckButtonByHand() {
  const macros = installedMacroList();
  if (!macros.length) {
    shell.updateStatusBar?.("No macros are installed yet.", { tone: "error" });
    return;
  }
  openFlightDeckButtonEditor({
    title: "Add Flight Deck Button",
    macroId: macros[0].id,
    macros,
    label: "",
    icon: iconForMacro(macroIndex.get(macros[0].id)),
    onApply: ({ macroId, label, icon }) => {
      const name = macroIndex.get(macroId)?.name || "";
      config.buttons.push({
        id: newButtonId(),
        macroId,
        label: label === name ? "" : label,
        icon: normalizeIcon(icon),
      });
      saveConfig();
      renderDeck();
      shell.updateStatusBar?.(`Added ${label || name || macroId} to the Flight Deck.`);
    },
  });
}

export async function addMacroToFlightDeck(macro) {
  if (!macro?.id) return;
  if (!(await ensureDeckDom())) return;
  ensureWired();
  macroIndex.set(macro.id, macro);
  config.buttons.push({
    id: newButtonId(),
    macroId: macro.id,
    label: "",
    icon: iconForMacro(macro),
  });
  void openFlightDeck();
  saveConfig();
  renderDeck();
  shell.updateStatusBar?.(`Added ${macro.name || macro.id} to the Flight Deck.`);
}

/* ------------------------------------------------------- button interaction */

function initButtonInteraction() {
  if (!deckSlots) return;
  let drag = null;
  let suppressClick = false;

  const clearIndicators = () => {
    deckSlots.querySelectorAll(".dropBefore, .dropAfter").forEach((element) => {
      element.classList.remove("dropBefore", "dropAfter");
    });
  };

  const finish = () => {
    drag?.ghost?.remove();
    drag?.element.classList.remove("dragSource");
    clearIndicators();
    window.removeEventListener("keydown", onDragKeyDown, true);
    drag = null;
  };

  function onDragKeyDown(event) {
    if (event.key !== "Escape" || !drag?.active) return;
    event.preventDefault();
    event.stopPropagation();
    suppressClick = true;
    finish();
  }

  const targetFor = (event) => {
    const element = document.elementFromPoint(event.clientX, event.clientY);
    if (!deck?.contains(element)) return { kind: "remove" };
    const over = element?.closest?.(".flightDeckBtn");
    if (!over || over === drag.element) return null;
    const rect = over.getBoundingClientRect();
    const before = isVertical()
      ? event.clientY < rect.top + rect.height / 2
      : event.clientX < rect.left + rect.width / 2;
    over.classList.add(before ? "dropBefore" : "dropAfter");
    const beforeId = before
      ? over.dataset.buttonId
      : (over.nextElementSibling?.dataset.buttonId || "");
    if (beforeId === drag.element.dataset.buttonId) return null;
    return { kind: "reorder", beforeId };
  };

  deckSlots.addEventListener("pointerdown", (event) => {
    const element = event.target?.closest?.(".flightDeckBtn");
    if (event.button !== 0 || !element) return;
    suppressClick = false;
    drag = { pointerId: event.pointerId, element, startX: event.clientX, startY: event.clientY, active: false, ghost: null, target: null };
    try { element.setPointerCapture(event.pointerId); } catch {}
  });

  deckSlots.addEventListener("pointermove", (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < DRAG_THRESHOLD_PX) return;
      drag.active = true;
      hideTooltip();
      drag.ghost = document.createElement("div");
      drag.ghost.className = "flightDeckDragGhost";
      document.body.appendChild(drag.ghost);
      drag.element.classList.add("dragSource");
      window.addEventListener("keydown", onDragKeyDown, true);
    }
    clearIndicators();
    drag.target = targetFor(event);
    const button = findButton(drag.element.dataset.buttonId);
    const name = button ? buttonLabel(button) : "";
    drag.ghost.dataset.kind = drag.target?.kind || "";
    drag.ghost.textContent = drag.target?.kind === "remove" ? `Remove ${name}` : name;
    drag.ghost.style.left = `${event.clientX + GHOST_OFFSET_PX}px`;
    drag.ghost.style.top = `${event.clientY + GHOST_OFFSET_PX}px`;
  });

  const stop = (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    try { drag.element.releasePointerCapture(event.pointerId); } catch {}
    if (!drag.active) {
      drag = null;
      return;
    }
    const buttonId = drag.element.dataset.buttonId;
    const target = event.type === "pointerup" ? drag.target : null;
    suppressClick = true;
    finish();
    if (target?.kind === "remove") removeDeckButton(buttonId);
    else if (target?.kind === "reorder") moveDeckButton(buttonId, target.beforeId);
  };

  deckSlots.addEventListener("pointerup", stop);
  deckSlots.addEventListener("pointercancel", stop);

  deckSlots.addEventListener("click", (event) => {
    const element = event.target?.closest?.(".flightDeckBtn");
    if (!element) return;
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    void runDeckButton(element.dataset.buttonId);
  });

  deckSlots.addEventListener("contextmenu", (event) => {
    const element = event.target?.closest?.(".flightDeckBtn");
    if (!element) return;
    event.preventDefault();
    event.stopPropagation();
    openButtonMenu(element.dataset.buttonId, event.clientX, event.clientY);
  });

  deckSlots.addEventListener("pointerover", (event) => {
    const element = event.target?.closest?.(".flightDeckBtn");
    if (element) showTooltip(element, event);
  });
  deckSlots.addEventListener("pointerout", hideTooltip);

  deckSlots.addEventListener("keydown", (event) => {
    const element = event.target?.closest?.(".flightDeckBtn");
    if (!element) return;
    const forward = isVertical() ? "ArrowDown" : "ArrowRight";
    const back = isVertical() ? "ArrowUp" : "ArrowLeft";
    if (event.key === forward) element.nextElementSibling?.focus?.();
    else if (event.key === back) element.previousElementSibling?.focus?.();
    else if (event.key === "Delete") removeDeckButton(element.dataset.buttonId);
    else if (event.key === "F2") editDeckButton(element.dataset.buttonId);
    else return;
    event.preventDefault();
  });
}

/* ------------------------------------------------------------------- menus */

function ensureDeckMenu() {
  if (deckMenu?.isConnected) return deckMenu;
  deckMenu = document.createElement("div");
  deckMenu.className = "flightDeckMenu";
  deckMenu.setAttribute("role", "menu");
  deckMenu.hidden = true;
  document.body.appendChild(deckMenu);
  deckMenu.addEventListener("click", (event) => {
    const item = event.target?.closest?.(".flightDeckMenuItem");
    if (!item) return;
    const action = item.dataset.action || "";
    const buttonId = deckMenu.dataset.buttonId || "";
    closeDeckMenu();
    runMenuAction(action, buttonId);
  });
  return deckMenu;
}

function menuItem(label, action, { checked = null, shortcut = "", danger = false } = {}) {
  const item = document.createElement("button");
  item.className = `flightDeckMenuItem${danger ? " danger" : ""}`;
  item.type = "button";
  item.dataset.action = action;
  item.setAttribute("role", checked === null ? "menuitem" : "menuitemradio");
  if (checked !== null) item.setAttribute("aria-checked", checked ? "true" : "false");
  const text = document.createElement("span");
  text.textContent = label;
  item.appendChild(text);
  if (shortcut) {
    const hint = document.createElement("span");
    hint.className = "flightDeckMenuShortcut";
    hint.textContent = shortcut;
    item.appendChild(hint);
  }
  return item;
}

function positionMenu(menu, x, y) {
  menu.hidden = false;
  const rect = menu.getBoundingClientRect();
  const left = Math.max(EDGE_MARGIN, Math.min(x, window.innerWidth - rect.width - EDGE_MARGIN));
  const top = Math.max(EDGE_MARGIN, Math.min(y, window.innerHeight - rect.height - EDGE_MARGIN));
  menu.style.left = `${Math.round(left)}px`;
  menu.style.top = `${Math.round(top)}px`;
}

function openButtonMenu(buttonId, x, y) {
  const button = findButton(buttonId);
  if (!button) return;
  const menu = ensureDeckMenu();
  menu.dataset.buttonId = buttonId;
  menu.textContent = "";
  menu.appendChild(menuItem("Run", "run"));
  menu.appendChild(menuItem("Edit Button...", "edit", { shortcut: "F2" }));
  const separator = document.createElement("div");
  separator.className = "flightDeckMenuSep";
  menu.appendChild(separator);
  menu.appendChild(menuItem("Remove From Deck", "remove", { shortcut: "Del", danger: true }));
  positionMenu(menu, x, y);
}

function openDeckMenu() {
  const menu = ensureDeckMenu();
  menu.dataset.buttonId = "";
  menu.textContent = "";
  menu.appendChild(menuItem("Horizontal", "orientation-horizontal", { checked: !isVertical() }));
  menu.appendChild(menuItem("Vertical", "orientation-vertical", { checked: isVertical() }));
  const firstSep = document.createElement("div");
  firstSep.className = "flightDeckMenuSep";
  menu.appendChild(firstSep);
  menu.appendChild(menuItem("Add Button...", "add"));
  menu.appendChild(menuItem("Open Macros Window", "open-macros"));
  const secondSep = document.createElement("div");
  secondSep.className = "flightDeckMenuSep";
  menu.appendChild(secondSep);
  menu.appendChild(menuItem("Remove All Buttons", "clear", { danger: true }));
  menu.appendChild(menuItem("Hide Flight Deck", "hide", { shortcut: "Ctrl+B" }));
  const rect = deckMenuBtn?.getBoundingClientRect();
  positionMenu(menu, rect ? rect.left : EDGE_MARGIN, rect ? rect.bottom + 4 : EDGE_MARGIN);
  deckMenuBtn?.setAttribute("aria-expanded", "true");
}

function closeDeckMenu() {
  if (deckMenu) deckMenu.hidden = true;
  deckMenuBtn?.setAttribute("aria-expanded", "false");
}

function setOrientation(orientation) {
  config.orientation = orientation === "vertical" ? "vertical" : "horizontal";
  saveConfig();
  renderDeck();
  applyPosition(config.position?.left ?? EDGE_MARGIN, config.position?.top ?? EDGE_MARGIN);
  saveConfig();
}

function runMenuAction(action, buttonId) {
  if (action === "run") void runDeckButton(buttonId);
  else if (action === "edit") editDeckButton(buttonId);
  else if (action === "remove") removeDeckButton(buttonId);
  else if (action === "add") addDeckButtonByHand();
  else if (action === "orientation-horizontal") setOrientation("horizontal");
  else if (action === "orientation-vertical") setOrientation("vertical");
  else if (action === "open-macros") shell.openMacroWindow?.();
  else if (action === "clear") {
    if (!config.buttons.length) return;
    config.buttons = [];
    saveConfig();
    renderDeck();
    shell.updateStatusBar?.("Cleared the Flight Deck.");
  } else if (action === "hide") closeFlightDeck();
}

/* -------------------------------------------------------------------- open */

function ensureWired() {
  if (deckWired || !deck) return;
  deckWired = true;
  initDeckDrag();
  initButtonInteraction();
  deckCloseBtn?.addEventListener("click", closeFlightDeck);
  deckMenuBtn?.addEventListener("click", (event) => {
    event.stopPropagation();
    if (deckMenu && !deckMenu.hidden) closeDeckMenu();
    else openDeckMenu();
  });
  [deckGrip, deckMenuBtn, deckCloseBtn].forEach((element) => {
    element?.addEventListener("pointerover", (event) => showTooltip(element, event));
    element?.addEventListener("pointerout", hideTooltip);
  });
  document.addEventListener("pointerdown", (event) => {
    if (deckMenu?.hidden !== false) return;
    if (event.target?.closest?.(".flightDeckMenu, #flightDeckMenuBtn")) return;
    closeDeckMenu();
  }, true);
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || deckMenu?.hidden !== false) return;
    closeDeckMenu();
    event.preventDefault();
    event.stopPropagation();
  }, true);
  window.addEventListener("resize", () => {
    if (!isFlightDeckVisible()) return;
    applyPosition(config.position?.left ?? EDGE_MARGIN, config.position?.top ?? EDGE_MARGIN);
  });
  window.addEventListener("arcrho:local-macros-changed", () => void loadMacroIndex(true));
  window.addEventListener("arcrho:flight-deck-add-macro", (event) => {
    void addMacroToFlightDeck(event?.detail?.macro || null);
  });
}

export function isFlightDeckVisible() {
  return !!deck?.classList.contains("open");
}

export async function openFlightDeck() {
  await ensureConfigLoaded();
  if (!(await ensureDeckDom())) return;
  ensureWired();
  renderDeck();
  deck.classList.add("open");
  restorePosition();
  config.visible = true;
  saveConfig();
  void loadMacroIndex();
}

export function closeFlightDeck() {
  closeDeckMenu();
  hideTooltip();
  deck?.classList.remove("open");
  config.visible = false;
  saveConfig();
}

export function toggleFlightDeck() {
  if (isFlightDeckVisible()) {
    closeFlightDeck();
    shell.updateStatusBar?.("Flight Deck hidden.");
    return;
  }
  void openFlightDeck().then(() => {
    if (isFlightDeckVisible()) shell.updateStatusBar?.("Flight Deck shown.");
  });
}

export async function initFlightDeck() {
  await ensureConfigLoaded();
  if (!config.visible) return;
  await openFlightDeck();
}
