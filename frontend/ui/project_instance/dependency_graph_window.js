// Dependency Graph page.
//
// This runs inside a Project Instance nested window (pi-window). The host frame
// in project_instance_windows.js owns the titlebar, dragging, resizing,
// minimize/maximize/close and the dock; this page owns the diagram: every
// dataset and method output of one reserving class as a box, every precedent
// as an arrow into what reads it. The window is pinned to the reserving class
// it was opened on, which arrives in the query string, so selecting another
// class in the tree leaves it alone exactly like a Dataset or DFM window.
//
// The whole graph is one hosted read (/datasets/dependency-graph); the layout
// is computed here from dependency_graph_layout.js. Hovering a box lights its
// inputs in blue and what depends on it in green; clicking a box asks the
// Project Instance page to open it - a dataset in Dataset Viewer, a method
// output in its method page - through the same
// arcrho:project-instance-open-dependent-dataset message a method page uses
// for a precedent. The host posts arcrho:dependency-graph-refresh whenever it
// reloads its own dataset table from disk, so the diagram follows a save, a
// delete, or an import without a manual refresh.
import { attachArcrhoTooltip } from "/ui/shared/components/tooltip/tooltip.js?v=20260812a";
import {
  buildDependencyGraph,
  dependencyGraphKey,
  dependencyGraphReach,
  layoutDependencyGraph,
} from "/ui/project_instance/dependency_graph_layout.js?v=20260909a";
import "/ui/shared/integrations/zoom_bridge.js?v=20260521a";

const GRAPH_ENDPOINT = "/datasets/dependency-graph";
const SVG_NS = "http://www.w3.org/2000/svg";
const ZOOM_MIN = 0.2;
const ZOOM_MAX = 2.5;
const ZOOM_STEP = 1.2;
const FIT_PADDING = 16;

function text(value) {
  return String(value ?? "").trim();
}

function count(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) && numeric > 0 ? Math.floor(numeric) : 0;
}

export function dependencyGraphSummary({ nodeCount, edgeCount, reviewCount }) {
  const nodes = count(nodeCount);
  if (!nodes) return "";
  const edges = count(edgeCount);
  const review = count(reviewCount);
  return `${nodes} object${nodes === 1 ? "" : "s"}, ${edges} link${edges === 1 ? "" : "s"}.`
    + (review ? ` ${review} need${review === 1 ? "s" : ""} review.` : "");
}

/**
 * The open request one box sends the Project Instance page.
 *
 * A method output opens as its method, by the method name the index recorded,
 * so a DFM whose method name differs from its output dataset still opens. A
 * name the index no longer lists cannot be opened at all.
 */
export function dependencyGraphOpenRequest(node, { projectName, reservingClass } = {}) {
  if (!node || node.inIndex === false) return null;
  const request = {
    datasetName: node.name,
    datasetTypeName: node.datasetType || node.name,
    projectName: text(projectName),
    reservingClass: text(reservingClass),
    openMethod: !!node.methodType,
  };
  if (node.methodType) {
    request.methodType = node.methodType;
    request.methodName = node.methodName || node.name;
  }
  return request;
}

/**
 * The hover text of one box: its type, formula, and what it links to. The
 * shared tooltip shows one wrapped paragraph, so the parts are separated by a
 * middle dot rather than line breaks.
 */
export function dependencyGraphNodeTooltip(node, graph) {
  const lines = [node.name];
  if (node.datasetType && node.datasetType !== node.name) lines.push(`Dataset Type: ${node.datasetType}`);
  lines.push(node.kind.label);
  if (node.formula) lines.push(`Formula: ${node.formula}`);
  if (node.status === 2) lines.push("Needs review");
  const names = (keys) => keys.map((key) => graph.byKey.get(key)?.name || key).join(", ");
  if (node.precedents.length) lines.push(`Precedents: ${names(node.precedents)}`);
  if (node.dependents.length) lines.push(`Dependents: ${names(node.dependents)}`);
  return lines.join(" · ");
}

const params = new URLSearchParams(window.location.search);
const inst = text(params.get("inst"));
const projectName = text(params.get("project"));
const reservingClass = text(params.get("class"));

const els = {
  search: document.getElementById("dependencyGraphSearch"),
  zoomOut: document.getElementById("dependencyGraphZoomOut"),
  zoomIn: document.getElementById("dependencyGraphZoomIn"),
  fit: document.getElementById("dependencyGraphFit"),
  refresh: document.getElementById("dependencyGraphRefresh"),
  canvas: document.getElementById("dependencyGraphCanvas"),
  svg: document.getElementById("dependencyGraphSvg"),
  state: document.getElementById("dependencyGraphState"),
  status: document.getElementById("dependencyGraphStatus"),
};

const view = {
  graph: null,
  layout: null,
  viewport: null,
  nodeEls: new Map(),
  edgeEls: [],
  scale: 1,
  tx: 0,
  ty: 0,
  focusKey: "",
  query: "",
  requestSeq: 0,
  loading: false,
  loaded: false,
};

function postToParent(type, payload = {}) {
  try {
    window.parent?.postMessage({ type, inst, ...payload }, "*");
  } catch {}
}

function setStatus(message, tone = "") {
  if (!els.status) return;
  els.status.textContent = message || "";
  els.status.classList.toggle("error", tone === "error");
}

function showState(message) {
  if (!els.state) return;
  els.state.textContent = message || "";
  els.state.hidden = !message;
}

function syncControls() {
  const busy = view.loading;
  const empty = !view.layout?.nodes.length;
  if (els.refresh) els.refresh.disabled = busy;
  for (const button of [els.zoomOut, els.zoomIn, els.fit]) {
    if (button) button.disabled = busy || empty;
  }
}

// ---------------------------------------------------------------------------
// Viewport: pan and zoom over one transformed group
// ---------------------------------------------------------------------------

function applyTransform() {
  view.viewport?.setAttribute("transform", `translate(${view.tx} ${view.ty}) scale(${view.scale})`);
}

function canvasSize() {
  const rect = els.canvas?.getBoundingClientRect();
  return { width: rect?.width || 0, height: rect?.height || 0 };
}

function fitGraph() {
  const layout = view.layout;
  if (!layout?.nodes.length) return;
  const { width, height } = canvasSize();
  if (!width || !height) return;
  const scale = Math.min(
    (width - FIT_PADDING * 2) / layout.width,
    (height - FIT_PADDING * 2) / layout.height,
    1,
  );
  view.scale = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, scale));
  view.tx = (width - layout.width * view.scale) / 2;
  view.ty = (height - layout.height * view.scale) / 2;
  applyTransform();
}

function zoomAt(factor, clientX, clientY) {
  if (!view.layout?.nodes.length) return;
  const next = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, view.scale * factor));
  if (next === view.scale) return;
  const rect = els.canvas.getBoundingClientRect();
  const px = clientX == null ? rect.width / 2 : clientX - rect.left;
  const py = clientY == null ? rect.height / 2 : clientY - rect.top;
  // Keep the point under the cursor where it is.
  view.tx = px - ((px - view.tx) / view.scale) * next;
  view.ty = py - ((py - view.ty) / view.scale) * next;
  view.scale = next;
  applyTransform();
}

function installPanAndZoom() {
  const svg = els.svg;
  if (!svg) return;
  let drag = null;
  const stop = () => {
    if (!drag) return;
    try { svg.releasePointerCapture(drag.pointerId); } catch {}
    svg.removeEventListener("pointermove", onMove);
    svg.removeEventListener("pointerup", stop);
    svg.removeEventListener("pointercancel", stop);
    svg.removeEventListener("lostpointercapture", stop);
    svg.classList.remove("is-panning");
    drag = null;
  };
  const onMove = (event) => {
    if (!drag || event.pointerId !== drag.pointerId) return;
    view.tx = drag.tx + (event.clientX - drag.x);
    view.ty = drag.ty + (event.clientY - drag.y);
    applyTransform();
  };
  svg.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || drag) return;
    if (event.target.closest(".dg-node")) return;
    drag = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, tx: view.tx, ty: view.ty };
    svg.setPointerCapture(event.pointerId);
    svg.classList.add("is-panning");
    svg.addEventListener("pointermove", onMove);
    svg.addEventListener("pointerup", stop);
    svg.addEventListener("pointercancel", stop);
    svg.addEventListener("lostpointercapture", stop);
    event.preventDefault();
  });
  svg.addEventListener("wheel", (event) => {
    // The application zoom bridge owns Ctrl + wheel; a plain wheel zooms the
    // diagram around the cursor.
    if (event.ctrlKey) return;
    event.preventDefault();
    zoomAt(event.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP, event.clientX, event.clientY);
  }, { passive: false });
  window.addEventListener("beforeunload", stop);
}

// ---------------------------------------------------------------------------
// Rendering
// ---------------------------------------------------------------------------

function svgEl(tag, attributes = {}) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [name, value] of Object.entries(attributes)) el.setAttribute(name, String(value));
  return el;
}

function arrowMarker(id, className) {
  const marker = svgEl("marker", {
    id,
    viewBox: "0 0 10 10",
    refX: 9,
    refY: 5,
    markerWidth: 7,
    markerHeight: 7,
    orient: "auto",
    markerUnits: "strokeWidth",
  });
  const path = svgEl("path", { d: "M0 1L9 5L0 9z" });
  path.setAttribute("class", className);
  marker.appendChild(path);
  return marker;
}

function openNode(node) {
  const request = dependencyGraphOpenRequest(node, { projectName, reservingClass });
  if (!request) {
    setStatus(`${node.name} is not in the class index and cannot be opened.`, "error");
    return;
  }
  postToParent("arcrho:project-instance-open-dependent-dataset", request);
  setStatus(request.openMethod
    ? `Opening ${node.methodType} method ${node.name}...`
    : `Opening dataset ${node.name}...`);
}

function buildNodeElement(node) {
  const box = document.createElement("div");
  box.className = "dg-node";
  box.dataset.key = node.key;
  box.dataset.family = node.kind.family;
  box.tabIndex = 0;
  box.setAttribute("role", "button");
  box.setAttribute("aria-label", node.methodType
    ? `Open ${node.methodType} method ${node.name}`
    : `Open dataset ${node.name}`);

  const name = document.createElement("span");
  name.className = "dg-node-name";
  name.textContent = node.name;
  box.appendChild(name);

  const kind = document.createElement("span");
  kind.className = "dg-node-kind";
  const label = document.createElement("span");
  label.className = "dg-node-kind-label";
  label.textContent = node.kind.label;
  kind.appendChild(label);
  if (node.status === 2) {
    const review = document.createElement("span");
    review.className = "dg-node-review";
    review.setAttribute("title", "Needs review");
    kind.appendChild(review);
  }
  box.appendChild(kind);

  attachArcrhoTooltip(box, () => dependencyGraphNodeTooltip(node, view.graph));
  box.addEventListener("mouseenter", () => setFocus(node.key));
  box.addEventListener("mouseleave", () => setFocus(""));
  box.addEventListener("focus", () => setFocus(node.key));
  box.addEventListener("blur", () => setFocus(""));
  box.addEventListener("click", () => openNode(node));
  box.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      openNode(node);
    }
  });
  return box;
}

function render() {
  const svg = els.svg;
  const layout = view.layout;
  if (!svg || !layout) return;
  svg.replaceChildren();
  view.nodeEls = new Map();
  view.edgeEls = [];

  const defs = svgEl("defs");
  defs.appendChild(arrowMarker("dgArrow", "dg-arrow"));
  defs.appendChild(arrowMarker("dgArrowUpstream", "dg-arrow dg-arrow-upstream"));
  defs.appendChild(arrowMarker("dgArrowDownstream", "dg-arrow dg-arrow-downstream"));
  svg.appendChild(defs);

  const viewport = svgEl("g");
  viewport.setAttribute("class", "dg-viewport");
  for (const edge of layout.edges) {
    const path = svgEl("path", { d: edge.path });
    path.setAttribute("class", edge.back ? "dg-edge is-back" : "dg-edge");
    viewport.appendChild(path);
    view.edgeEls.push({ edge, el: path });
  }
  for (const node of layout.nodes) {
    const holder = svgEl("foreignObject", { x: node.x, y: node.y, width: node.width, height: node.height });
    const box = buildNodeElement(node);
    holder.appendChild(box);
    viewport.appendChild(holder);
    view.nodeEls.set(node.key, box);
  }
  svg.appendChild(viewport);
  view.viewport = viewport;
  applyTransform();
  applyHighlight();
}

// ---------------------------------------------------------------------------
// Highlighting: hover reach and search matches
// ---------------------------------------------------------------------------

function setFocus(key) {
  if (view.focusKey === key) return;
  view.focusKey = key;
  applyHighlight();
}

function applyHighlight() {
  const graph = view.graph;
  if (!graph) return;
  const query = view.query;
  const focus = view.focusKey;
  const reach = focus ? dependencyGraphReach(graph, focus) : null;
  const matches = new Set();
  if (query) {
    for (const node of graph.nodes) {
      if (node.key.includes(query) || dependencyGraphKey(node.datasetType).includes(query)) matches.add(node.key);
    }
  }
  for (const [key, el] of view.nodeEls) {
    const isFocus = key === focus;
    const inReach = !!reach && (reach.upstream.has(key) || reach.downstream.has(key));
    const isMatch = matches.has(key);
    el.classList.toggle("is-focus", isFocus);
    el.classList.toggle("is-match", isMatch);
    el.classList.toggle("is-dim", focus ? !(isFocus || inReach) : (!!query && !isMatch));
  }
  for (const { edge, el } of view.edgeEls) {
    const upstream = !!reach && reach.upstream.has(edge.source)
      && (edge.target === focus || reach.upstream.has(edge.target));
    const downstream = !!reach && reach.downstream.has(edge.target)
      && (edge.source === focus || reach.downstream.has(edge.source));
    el.classList.toggle("is-upstream", upstream);
    el.classList.toggle("is-downstream", downstream);
    el.classList.toggle("is-dim", focus
      ? !(upstream || downstream)
      : (!!query && !(matches.has(edge.source) && matches.has(edge.target))));
  }
}

// ---------------------------------------------------------------------------
// Loading
// ---------------------------------------------------------------------------

async function loadGraph({ keepViewport = false } = {}) {
  if (!projectName || !reservingClass) {
    showState("Project and reserving class are required.");
    setStatus("Project and reserving class are required.", "error");
    return;
  }
  const seq = ++view.requestSeq;
  view.loading = true;
  syncControls();
  if (!view.loaded) showState("Loading dependency graph...");
  setStatus("Loading dependency graph...");
  try {
    const query = new URLSearchParams({ project_name: projectName, reserving_class: reservingClass });
    const response = await fetch(`${GRAPH_ENDPOINT}?${query.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (seq !== view.requestSeq) return;
    if (!response.ok || payload?.ok === false) {
      const detail = payload?.detail;
      throw new Error(typeof detail === "string" && detail.trim() ? detail.trim() : `HTTP ${response.status}`);
    }
    view.graph = buildDependencyGraph(payload);
    view.layout = layoutDependencyGraph(view.graph);
    view.loading = false;
    view.loaded = true;
    render();
    if (!view.layout.nodes.length) {
      showState("This reserving class has no datasets yet.");
    } else {
      showState("");
      if (!keepViewport) fitGraph();
    }
    setStatus(dependencyGraphSummary({
      nodeCount: view.layout.nodes.length,
      edgeCount: view.layout.edges.length,
      reviewCount: view.layout.nodes.filter((node) => node.status === 2).length,
    }));
  } catch (error) {
    if (seq !== view.requestSeq) return;
    view.loading = false;
    if (!view.loaded) showState("Dependency graph could not be loaded.");
    setStatus(`Could not load dependency graph: ${error.message}`, "error");
  } finally {
    if (seq === view.requestSeq) syncControls();
  }
}

function init() {
  installPanAndZoom();
  els.zoomOut?.addEventListener("click", () => zoomAt(1 / ZOOM_STEP));
  els.zoomIn?.addEventListener("click", () => zoomAt(ZOOM_STEP));
  els.fit?.addEventListener("click", fitGraph);
  els.refresh?.addEventListener("click", () => void loadGraph({ keepViewport: true }));
  els.search?.addEventListener("input", () => {
    view.query = dependencyGraphKey(els.search.value);
    applyHighlight();
  });
  attachArcrhoTooltip(els.zoomOut, "Zoom out");
  attachArcrhoTooltip(els.zoomIn, "Zoom in");
  attachArcrhoTooltip(els.fit, "Fit to window");
  attachArcrhoTooltip(els.refresh, "Refresh");
  window.addEventListener("message", (event) => {
    if (event.data?.type === "arcrho:dependency-graph-refresh") void loadGraph({ keepViewport: true });
  });
  // A resize of the frame keeps the diagram fitted until the user has panned
  // or zoomed by hand.
  let userSteered = false;
  els.svg?.addEventListener("pointerdown", () => { userSteered = true; });
  els.svg?.addEventListener("wheel", () => { userSteered = true; });
  els.zoomIn?.addEventListener("click", () => { userSteered = true; });
  els.zoomOut?.addEventListener("click", () => { userSteered = true; });
  els.fit?.addEventListener("click", () => { userSteered = false; });
  new ResizeObserver(() => { if (!userSteered) fitGraph(); }).observe(els.canvas);
  syncControls();
  void loadGraph();
}

init();
