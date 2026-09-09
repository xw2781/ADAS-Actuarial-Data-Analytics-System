import { shell } from "../shell/shell_context.js?v=20260510a";
import { LIBRARY_STATUS_UPDATE_AVAILABLE, copyLibraryMacroToLocal, fetchLibraryMacros } from "./macro_library_client.js?v=20260908a";
import { createMacroWindowFrame } from "./macro_window_frame.js?v=20260808b";
import { initMacroListDrag, initMacroListKeyboard, syncMacroListSelection } from "./macro_list_interactions.js?v=20260908a";

const LIBRARY_WINDOW_FRAGMENT_URL = "/ui/macro/macro_library_window.html?v=20260731a";
const LIBRARY_WINDOW_POSITION_KEY = "arcrho_macro_library_window_position";
const LIBRARY_STATUS_META = {
  not_installed: { label: "New", className: "not-installed", action: "Load" },
  update_available: { label: "Update", className: "update-available", action: "Update" },
  up_to_date: { label: "Loaded", className: "up-to-date", action: "Loaded" },
  local_differs: { label: "Differs", className: "local-differs", action: "Load" },
};

let libraryWindow = null;
let libraryHeader = null;
let libraryRefreshBtn = null;
let libraryCloseBtn = null;
let libraryLoadBtn = null;
let libraryList = null;
let libraryDescription = null;
let libraryStatus = null;
let libraryWindowWired = false;
let libraryWindowLoadPromise = null;
let libraryMacros = [];
let libraryUnavailableMessage = "";
let selectedLibraryMacroId = "";
let libraryWindowFrame = null;

function refreshLibraryElements() {
  libraryWindow = document.getElementById("macroLibraryWindow");
  libraryHeader = document.getElementById("macroLibraryHeader");
  libraryRefreshBtn = document.getElementById("macroLibraryRefreshBtn");
  libraryCloseBtn = document.getElementById("macroLibraryCloseBtn");
  libraryLoadBtn = document.getElementById("macroLibraryLoadBtn");
  libraryList = document.getElementById("macroLibraryList");
  libraryDescription = document.getElementById("macroLibraryDescription");
  libraryStatus = document.getElementById("macroLibraryStatus");
  return !!libraryWindow;
}

async function ensureLibraryWindowDom() {
  if (refreshLibraryElements()) return true;
  if (!libraryWindowLoadPromise) {
    libraryWindowLoadPromise = fetch(LIBRARY_WINDOW_FRAGMENT_URL)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.text();
      })
      .then((markup) => {
        if (document.getElementById("macroLibraryWindow")) return;
        const template = document.createElement("template");
        template.innerHTML = markup.trim();
        document.body.appendChild(template.content);
      })
      .catch((err) => {
        libraryWindowLoadPromise = null;
        throw err;
      });
  }
  try {
    await libraryWindowLoadPromise;
  } catch (err) {
    const message = String(err?.message || err || "unable to load macro library window");
    shell.updateStatusBar?.(`Macro library window failed to load: ${message}`, { tone: "error" });
    return false;
  }
  return refreshLibraryElements();
}

function setLibraryStatus(text, tone = "", options = {}) {
  const message = String(text || "");
  if (libraryStatus) {
    libraryStatus.textContent = message;
    libraryStatus.title = message;
    libraryStatus.dataset.tone = tone || "";
  }
  if (options.statusBar && message) {
    shell.updateStatusBar?.(message, { tone: tone || "" });
  }
}

function libraryStatusMeta(macro) {
  return LIBRARY_STATUS_META[String(macro?.status || "")] || LIBRARY_STATUS_META.not_installed;
}

function getSelectedLibraryMacro() {
  return libraryMacros.find((macro) => macro.id === selectedLibraryMacroId) || null;
}

function selectLibraryMacro(id) {
  selectedLibraryMacroId = id;
  syncMacroListSelection(libraryList, id);
  renderLibraryDescription();
}

async function loadLibraryMacros() {
  setLibraryStatus("Loading macro library...");
  try {
    const result = await fetchLibraryMacros();
    libraryMacros = result.macros;
    libraryUnavailableMessage = result.available ? "" : (result.message || "Macro library is not available.");
    renderLibraryList();
    renderLibraryDescription();
    if (libraryUnavailableMessage) {
      setLibraryStatus(libraryUnavailableMessage, "error");
    } else {
      const updates = libraryMacros.filter((macro) => macro.status === LIBRARY_STATUS_UPDATE_AVAILABLE).length;
      setLibraryStatus(updates > 0
        ? `${libraryMacros.length} shared macro(s); ${updates} update(s) available.`
        : `${libraryMacros.length} shared macro(s) available.`);
    }
  } catch (err) {
    libraryMacros = [];
    libraryUnavailableMessage = String(err?.message || err || "Failed to load the macro library.");
    renderLibraryList();
    renderLibraryDescription();
    setLibraryStatus(`Failed to load the macro library. ${libraryUnavailableMessage}`, "error");
  }
}

function renderLibraryList() {
  if (!libraryList) return;
  libraryList.textContent = "";
  if (!libraryMacros.length) {
    const empty = document.createElement("div");
    empty.className = "macroEmpty";
    empty.textContent = libraryUnavailableMessage || "The shared macro library is empty.";
    libraryList.appendChild(empty);
    selectedLibraryMacroId = "";
    return;
  }
  if (!selectedLibraryMacroId || !libraryMacros.some((macro) => macro.id === selectedLibraryMacroId)) {
    selectedLibraryMacroId = libraryMacros[0]?.id || "";
  }
  libraryMacros.forEach((macro) => {
    const item = document.createElement("button");
    item.className = "macroListItem";
    item.type = "button";
    item.dataset.id = macro.id;
    item.classList.toggle("active", macro.id === selectedLibraryMacroId);
    item.setAttribute("aria-selected", macro.id === selectedLibraryMacroId ? "true" : "false");
    const topRow = document.createElement("span");
    topRow.className = "macroListItemTop";
    const title = document.createElement("span");
    title.className = "macroListItemName";
    title.textContent = macro.name || macro.id;
    topRow.appendChild(title);
    if (macro.version) {
      const version = document.createElement("span");
      version.className = "macroListItemVersion";
      version.textContent = `v${macro.version}`;
      topRow.appendChild(version);
    }
    const meta = libraryStatusMeta(macro);
    const status = document.createElement("span");
    status.className = `macroLibraryStatusTag ${meta.className}`;
    status.textContent = meta.label;
    topRow.appendChild(status);
    item.appendChild(topRow);
    item.addEventListener("click", () => selectLibraryMacro(macro.id));
    libraryList.appendChild(item);
  });
}

function renderLibraryDescription() {
  if (!libraryDescription) return;
  const macro = getSelectedLibraryMacro();
  if (!macro) {
    libraryDescription.textContent = libraryUnavailableMessage
      ? "The shared macro library is not reachable."
      : "Select a shared macro to view its details.";
    if (libraryLoadBtn) {
      libraryLoadBtn.textContent = "Load";
      libraryLoadBtn.disabled = true;
    }
    return;
  }
  const lines = [macro.description || "This macro has no description section yet."];
  const detailLines = [];
  if (macro.version) detailLines.push(`Library version: ${macro.version}`);
  if (macro.release_note) detailLines.push(`Release note: ${macro.release_note}`);
  if (macro.status === "not_installed") {
    detailLines.push("Not in your local macros yet.");
  } else if (macro.status === "up_to_date") {
    detailLines.push("Your local copy is up to date.");
  } else if (macro.status === LIBRARY_STATUS_UPDATE_AVAILABLE) {
    detailLines.push(`Your local copy is v${macro.local_version || "?"}; an update is available.`);
  } else if (macro.status === "local_differs") {
    detailLines.push(`Your local copy${macro.local_version ? ` (v${macro.local_version})` : ""} differs from the library version.`);
  }
  if (detailLines.length) lines.push("", ...detailLines);
  libraryDescription.textContent = lines.join("\n");
  const meta = libraryStatusMeta(macro);
  if (libraryLoadBtn) {
    libraryLoadBtn.textContent = meta.action;
    libraryLoadBtn.disabled = macro.status === "up_to_date";
  }
}

async function installLibraryMacro(macro = getSelectedLibraryMacro()) {
  if (!macro) {
    setLibraryStatus("Select a shared macro before loading.", "error", { statusBar: true });
    return;
  }
  if (libraryLoadBtn) libraryLoadBtn.disabled = true;
  setLibraryStatus(`Loading ${macro.name || macro.id} from the library...`);
  try {
    const result = await copyLibraryMacroToLocal(macro.id);
    if (result.cancelled) {
      setLibraryStatus("Library macro was not loaded; your local copy is unchanged.", "", { statusBar: true });
      renderLibraryDescription();
      return;
    }
    setLibraryStatus(result.message || `Loaded ${macro.name || macro.id}.`, "", { statusBar: true });
  } catch (err) {
    const message = String(err?.message || err || "Library macro load failed.");
    setLibraryStatus(`Library macro load failed: ${message}`, "error", { statusBar: true });
    renderLibraryDescription();
  }
}

export async function initMacroLibraryWindow() {
  if (libraryWindowWired && refreshLibraryElements()) return true;
  if (!(await ensureLibraryWindowDom())) return false;
  if (libraryWindowWired) return true;
  libraryWindowFrame = createMacroWindowFrame({
    getWindow: () => libraryWindow,
    getHeader: () => libraryHeader,
    storageKey: LIBRARY_WINDOW_POSITION_KEY,
  });
  libraryWindowFrame.init();
  libraryWindowWired = true;
  libraryCloseBtn?.addEventListener("click", closeMacroLibraryWindow);
  libraryRefreshBtn?.addEventListener("click", () => loadLibraryMacros());
  libraryLoadBtn?.addEventListener("click", () => installLibraryMacro());
  initMacroListKeyboard(libraryList, {
    getIds: () => libraryMacros.map((macro) => macro.id),
    onSelect: selectLibraryMacro,
  });
  initMacroListDrag(libraryList, libraryWindow, {
    getMacro: (id) => libraryMacros.find((macro) => macro.id === id) || null,
    outsideTarget: (element) => {
      const macroList = element?.closest?.("#macroWindow")?.querySelector("#macroList");
      return macroList ? { kind: "install", highlight: macroList } : null;
    },
    onStart: (macro) => selectLibraryMacro(macro.id),
    onDrop: (macro) => void installLibraryMacro(macro),
  });
  // Either window can load a macro, so both refresh from the same event.
  window.addEventListener("arcrho:local-macros-changed", () => {
    if (!libraryWindow?.classList.contains("open")) return;
    void loadLibraryMacros();
  });
  window.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    if (!libraryWindow?.classList.contains("open")) return;
    closeMacroLibraryWindow();
    event.preventDefault();
    event.stopPropagation();
    if (typeof event.stopImmediatePropagation === "function") event.stopImmediatePropagation();
  }, true);
  return true;
}

export async function openMacroLibraryWindow() {
  if (!(await initMacroLibraryWindow())) return;
  libraryWindowFrame?.restorePosition();
  libraryWindowFrame?.lockSize();
  libraryWindow?.classList.add("open");
  void loadLibraryMacros();
}

export function closeMacroLibraryWindow() {
  refreshLibraryElements();
  libraryWindow?.classList.remove("open");
}
