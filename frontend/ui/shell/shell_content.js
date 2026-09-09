import { $, shell } from "./shell_context.js?v=20260510a";
import { createIframeHost } from "./iframe_host.js?v=20260726b";
import { createFloatingTabsController, isFloatingTab } from "./floating_tabs.js?v=20260520b";
import { normalizeBrowsingHistoryEntry } from "/ui/shell/browsing_history.js";
import { renderHomeViewOnce } from "./home_view.js?v=20260908b";

const datasetAutoRefreshDone = new Set();
let homeView = null;
let iframeHost = null;
let floatingHost = null;
let iframeHostController = null;
let floatingTabs = null;
let ensureIframeImpl = () => {};

function initShellControllers() {
  if (!iframeHostController) {
    iframeHostController = createIframeHost({
      closeAllShellMenus: () => shell.closeAllShellMenus?.(),
      getColorTheme: () => shell.getColorTheme?.(),
      getIframeHost: () => iframeHost,
      getState: () => shell.state,
      handleShellFileDragOver: (event) => shell.handleShellFileDragOver?.(event),
      handleShellFileDrop: (event) => shell.handleShellFileDrop?.(event),
      normalizeBrowsingHistoryEntry,
      refreshActiveTab: () => shell.refreshActiveTab?.(),
      resolveHotkeyAction: (event) => shell.resolveHotkeyAction?.(event),
      runHotkeyAction: (action) => shell.runHotkeyAction?.(action),
      setActive: (id) => shell.setActive?.(id),
      uiVersionParam: shell.uiVersionParam,
    });
    ensureIframeImpl = iframeHostController.ensureIframe;
  }
  if (!floatingTabs) {
    floatingTabs = createFloatingTabsController({
      closeTab: (id) => shell.closeTab?.(id),
      dockTab: (id) => shell.dockTab?.(id),
      ensureIframe: (tab) => ensureIframe(tab),
      getContentElement: () => $("content"),
      getFloatingHost: () => floatingHost,
      getState: () => shell.state,
      render: () => shell.render?.(),
      saveState: () => shell.saveState?.(),
      setActive: (id) => shell.setActive?.(id),
      openTabContextMenu: (id, x, y) => shell.openTabCtxMenu?.(id, x, y),
      showGlobalTooltip: (text, x, y) => shell.showGlobalTooltip?.(text, x, y),
      hideGlobalTooltip: () => shell.hideGlobalTooltip?.(),
    });
  }
}

export function ensureContentContainers() {
  const content = $("content");
  if (!content) return;
  if (!homeView) {
    homeView = document.createElement("div");
    homeView.id = "homeView";
    homeView.className = "home";
    content.appendChild(homeView);
  }
  if (!iframeHost) {
    iframeHost = document.createElement("div");
    iframeHost.id = "iframeHost";
    iframeHost.style.width = "100%";
    iframeHost.style.height = "100%";
    iframeHost.style.position = "absolute";
    iframeHost.style.inset = "0";
    iframeHost.style.zIndex = "auto";
    iframeHost.style.pointerEvents = "none";
    content.appendChild(iframeHost);
  }
  if (!floatingHost) {
    floatingHost = document.createElement("div");
    floatingHost.id = "floatingHost";
    content.appendChild(floatingHost);
  }
  initShellControllers();
}

export function ensureIframe(tab) { return ensureIframeImpl(tab); }
export function clampFloatRect(rect) { return floatingTabs.clampFloatRect(rect); }
export function defaultFloatRectFromPointer(clientX, clientY) { return floatingTabs.defaultFloatRectFromPointer(clientX, clientY); }
export function updateFloatPreview(clientX, clientY) { floatingTabs.updateFloatPreview(clientX, clientY); }
export function removeFloatPreview() { floatingTabs?.removeFloatPreview(); }
export function applyDockedIframeLayout(tab) { floatingTabs.applyDockedIframeLayout(tab); }
export function renderFloatingWindows() { floatingTabs.renderFloatingWindows(); }
export function clampFloatingTabsToContent() { floatingTabs?.clampFloatingTabsToContent(); }

export function notifyBrowsingHistoryTabs(message = {}) {
  for (const t of shell.state.tabs || []) {
    if (t.type !== "browsing_history") continue;
    ensureIframe(t);
    if (!t.iframe || !t.iframe.contentWindow) continue;
    try { t.iframe.contentWindow.postMessage({ type: "arcrho:browsing-history-updated", ...message }, "*"); } catch {}
  }
}

export function notifyCalculatedDatasetTabs(message = {}) {
  for (const t of shell.state.tabs || []) {
    if (t.type !== "dataset" && t.type !== "project_instance" && t.type !== "dfm") continue;
    if (!t.iframe || !t.iframe.contentWindow) continue;
    try { t.iframe.contentWindow.postMessage({ type: "arcrho:calculated-datasets-updated", ...message }, "*"); } catch {}
  }
}

export function notifyServerConnectionUpdated(config = {}) {
  const message = { type: "arcrho:server-connection-updated", config };
  for (const t of shell.state.tabs || []) {
    if (t.type === "home") continue;
    if (!t.iframe || !t.iframe.contentWindow) continue;
    try { t.iframe.contentWindow.postMessage(message, "*"); } catch {}
  }
}

function autoRefreshDatasetOnce(tab) {
  if (!tab || tab.type !== "dataset") return false;
  const key = tab.id || tab.dsInst || "";
  if (!key || datasetAutoRefreshDone.has(key)) return false;
  datasetAutoRefreshDone.add(key);
  const iframe = tab.iframe;
  if (!iframe) return false;
  try {
    const cw = iframe.contentWindow;
    if (cw?.location?.reload) cw.location.reload();
    else {
      const src = iframe.getAttribute("src");
      if (src) iframe.setAttribute("src", src);
    }
  } catch {
    const src = iframe.getAttribute("src");
    if (src) iframe.setAttribute("src", src);
  }
  return true;
}

export function notifyTabActivated(tab) {
  if (!tab?.iframe) return;
  if (tab.type === "dataset") {
    if (autoRefreshDatasetOnce(tab)) return;
    try { tab.iframe.contentWindow.postMessage({ type: "arcrho:tab-activated" }, "*"); } catch {}
  }
  if (tab.type === "dfm") {
    try { tab.iframe.contentWindow.postMessage({ type: "arcrho:dfm-tab-activated" }, "*"); } catch {}
  }
  if (tab.type === "project_instance") {
    try { tab.iframe.contentWindow.postMessage({ type: "arcrho:tab-activated" }, "*"); } catch {}
  }
  if (tab.type === "browsing_history") {
    try { tab.iframe.contentWindow.postMessage({ type: "arcrho:tab-activated" }, "*"); } catch {}
  }
}

export function renderContent() {
  ensureContentContainers();
  renderHomeViewOnce(homeView);
  shell.ensureActiveTabInvariant?.();
  const activeTab = shell.state.tabs.find(t => t.id === shell.state.activeId) || shell.state.tabs[0];
  if (!activeTab) {
    shell.state.activeId = "home";
    return;
  }
  for (const t of shell.state.tabs) {
    if (t.type === "home") continue;
    ensureIframe(t);
    if (t.iframe) t.iframe.style.display = "none";
  }
  const visibleDockedTab = isFloatingTab(activeTab)
    ? (shell.state.tabs.find(t => t.id === shell.state.lastDockedActiveId && !isFloatingTab(t)) || shell.state.tabs.find(t => t.id === "home"))
    : activeTab;
  const homeIsVisible = !visibleDockedTab || visibleDockedTab.type === "home";
  if (homeIsVisible) {
    if (homeView) homeView.style.display = "block";
    if (iframeHost) iframeHost.style.display = shell.state.tabs.some(isFloatingTab) ? "block" : "none";
  } else {
    if (homeView) homeView.style.display = "none";
    if (iframeHost) iframeHost.style.display = "block";
    ensureIframe(visibleDockedTab);
    applyDockedIframeLayout(visibleDockedTab);
    if (visibleDockedTab.iframe) visibleDockedTab.iframe.style.display = "block";
  }
  renderFloatingWindows();
  for (const tab of shell.state.tabs) {
    if (tab.type !== "file_explorer" || !tab.iframe?.contentWindow) continue;
    try {
      tab.iframe.contentWindow.postMessage({
        type: "arcrho:file-explorer-visibility",
        visible: tab.iframe.style.display !== "none",
      }, "*");
    } catch {}
  }
  notifyTabActivated(activeTab);
}

export function printActiveTab() {
  const t = shell.state.tabs.find(x => x.id === shell.state.activeId);
  if (!t) return;
  if (t.type === "home") {
    window.print();
    return;
  }
  if (t.iframe && t.iframe.contentWindow) {
    try {
      t.iframe.contentWindow.focus();
      t.iframe.contentWindow.print();
      return;
    } catch {}
  }
  window.print();
}
