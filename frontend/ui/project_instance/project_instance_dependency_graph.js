// Project Instance host for the Dependency Graph nested window.
//
// The diagram itself lives in dependency_graph_window.html and runs inside a
// normal pi-window, so it drags, resizes, minimizes to the dock, maximizes,
// and closes exactly like a Dataset or DFM window. This module only opens that
// window from the dataset toolbar and tells every open graph window when the
// page has reloaded its dataset table from disk, so the diagram follows a
// save, a delete, or an import.
//
// The window is pinned to the reserving class it was opened on, like every
// other nested window: selecting another class in the tree leaves it alone and
// opens a second window for that class instead.
import { attachArcrhoTooltip } from "/ui/shared/components/tooltip/tooltip.js?v=20260812a";

export const DEPENDENCY_GRAPH_WINDOW_KIND = "dependency_graph";
export const DEPENDENCY_GRAPH_REFRESH_MESSAGE = "arcrho:dependency-graph-refresh";

export function installProjectInstanceDependencyGraph(ctx) {
  const { api, els, state, projectName } = ctx;
  const normalizePath = (...args) => api.normalizePath(...args);
  const setStatus = (...args) => api.setStatus(...args);

  function getDependencyGraphWindowKey(path) {
    // Same shape as the dataset and method window keys: a kind tag, the unit
    // separator, then the normalized reserving-class path.
    return `${DEPENDENCY_GRAPH_WINDOW_KIND}${normalizePath(path)}`;
  }

  function buildDependencyGraphWindowUrl(inst, path) {
    const params = new URLSearchParams();
    params.set("project", projectName);
    params.set("class", path);
    params.set("inst", inst);
    params.set("project_instance", "1");
    params.set("v", String(Date.now()));
    return `/ui/project_instance/dependency_graph_window.html?${params.toString()}`;
  }

  function isDependencyGraphWindow(frame) {
    return frame?.dataset?.windowKind === DEPENDENCY_GRAPH_WINDOW_KIND;
  }

  function openDependencyGraph() {
    const path = normalizePath(state.selectedPath);
    if (!path) {
      setStatus("Select a reserving class path before opening the dependency graph.", true);
      return null;
    }
    const inst = `pi_dependency_graph_${Date.now()}_${state.windowSeq++}`;
    // An already-open window for this class is re-activated rather than duplicated.
    return api.createFloatingContentWindow({
      kind: DEPENDENCY_GRAPH_WINDOW_KIND,
      name: "Dependency Graph",
      itemName: "Dependency Graph",
      title: `${path}\\Dependency Graph`,
      windowKey: getDependencyGraphWindowKey(path),
      inst,
      iframeSrc: buildDependencyGraphWindowUrl(inst, path),
      path,
    });
  }

  /** Tells every graph window of one reserving class to reload its diagram. */
  function notifyDependencyGraphWindows(path) {
    const target = normalizePath(path);
    const frames = els.windowLayer?.querySelectorAll(`.pi-window[data-window-kind="${DEPENDENCY_GRAPH_WINDOW_KIND}"]`) || [];
    for (const frame of frames) {
      if (normalizePath(frame.dataset.windowPath) !== target) continue;
      try {
        frame.querySelector("iframe")?.contentWindow?.postMessage({ type: DEPENDENCY_GRAPH_REFRESH_MESSAGE }, "*");
      } catch {}
    }
  }

  function initDependencyGraph() {
    if (!els.dependencyGraphBtn || els.dependencyGraphBtn.dataset.wired === "1") return;
    els.dependencyGraphBtn.dataset.wired = "1";
    attachArcrhoTooltip(els.dependencyGraphBtn, "Dependency Graph");
    els.dependencyGraphBtn.addEventListener("click", () => void openDependencyGraph());
  }

  Object.assign(api, {
    initDependencyGraph,
    isDependencyGraphWindow,
    notifyDependencyGraphWindows,
    openDependencyGraph,
  });
}
