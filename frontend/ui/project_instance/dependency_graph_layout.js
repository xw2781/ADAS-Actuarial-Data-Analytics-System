// Dependency Graph layout.
//
// Pure functions the Dependency Graph window draws from: the server's node and
// edge lists become a layered left-to-right diagram - inputs on the left, the
// methods that consume everything on the right - with each node given a box
// and each edge a curve. Nothing here touches the DOM, so the layering,
// ordering, and reach rules are pinned by
// frontend/tests/project_instance_dependency_graph.test.mjs.

export const DEPENDENCY_GRAPH_NODE_WIDTH = 188;
export const DEPENDENCY_GRAPH_NODE_HEIGHT = 40;
export const DEPENDENCY_GRAPH_COLUMN_GAP = 64;
export const DEPENDENCY_GRAPH_ROW_GAP = 14;
export const DEPENDENCY_GRAPH_MARGIN = 24;
const BARYCENTER_SWEEPS = 4;

const KIND_LABEL_BY_SOURCE_KIND = Object.freeze({
  input: "Dataset",
  calculated: "Calculated",
  engine: "Engine",
});

function text(value) {
  return String(value ?? "").trim();
}

export function dependencyGraphKey(name) {
  return text(name).replace(/\s+/gu, " ").toLowerCase();
}

/**
 * The family a node is drawn as and the label its second line shows.
 *
 * A method output is labelled by its method type; a plain dataset by whether
 * it is entered, calculated by a formula, or built by the Engine. A name a
 * sidecar still references but the index no longer lists is its own family, so
 * a dangling edge reads as a problem rather than as a dataset.
 */
export function dependencyNodeKind(node = {}) {
  if (node.in_index === false || node.inIndex === false) {
    return { family: "missing", label: "Not In Index" };
  }
  const methodType = text(node.method_type ?? node.methodType);
  if (methodType && methodType.toLowerCase() !== "none") {
    return { family: "method", label: methodType };
  }
  const sourceKind = text(node.source_kind ?? node.sourceKind).toLowerCase();
  if (sourceKind === "calculated" || sourceKind === "engine") {
    return { family: sourceKind, label: KIND_LABEL_BY_SOURCE_KIND[sourceKind] };
  }
  return { family: "dataset", label: KIND_LABEL_BY_SOURCE_KIND.input };
}

/**
 * Normalizes the server payload into keyed nodes and deduplicated edges.
 *
 * An edge naming a node the payload does not carry, or naming one node on both
 * ends, is dropped; the server already kept every referenced name as a node,
 * so nothing real is lost here.
 */
export function buildDependencyGraph(payload = {}) {
  const byKey = new Map();
  const nodes = [];
  for (const raw of Array.isArray(payload.nodes) ? payload.nodes : []) {
    const name = text(raw?.name);
    const key = dependencyGraphKey(name);
    if (!key || byKey.has(key)) continue;
    const methodType = text(raw.method_type);
    const node = {
      key,
      name,
      datasetType: text(raw.dataset_type) || name,
      sourceKind: text(raw.source_kind).toLowerCase(),
      methodType: methodType.toLowerCase() === "none" ? "" : methodType,
      methodName: text(raw.method_name),
      status: Number(raw.status) === 2 ? 2 : 0,
      formula: text(raw.formula),
      inIndex: raw.in_index !== false,
      kind: dependencyNodeKind(raw),
      precedents: [],
      dependents: [],
    };
    byKey.set(key, node);
    nodes.push(node);
  }
  const edges = [];
  const seen = new Set();
  for (const raw of Array.isArray(payload.edges) ? payload.edges : []) {
    const source = dependencyGraphKey(raw?.source);
    const target = dependencyGraphKey(raw?.target);
    if (!byKey.has(source) || !byKey.has(target) || source === target) continue;
    const id = `${source}${target}`;
    if (seen.has(id)) continue;
    seen.add(id);
    edges.push({ source, target });
    byKey.get(source).dependents.push(target);
    byKey.get(target).precedents.push(source);
  }
  return { nodes, edges, byKey };
}

/**
 * Everything upstream of one node (what it is computed from, transitively)
 * and everything downstream (what recomputes when it changes).
 */
export function dependencyGraphReach(graph, key) {
  const walk = (start, field) => {
    const reached = new Set();
    const stack = [...(graph.byKey.get(start)?.[field] || [])];
    while (stack.length) {
      const next = stack.pop();
      if (reached.has(next)) continue;
      reached.add(next);
      stack.push(...(graph.byKey.get(next)?.[field] || []));
    }
    reached.delete(start);
    return reached;
  };
  return { upstream: walk(key, "precedents"), downstream: walk(key, "dependents") };
}

/**
 * The boxes the diagram leaves out until Show all is ticked: a dataset that
 * nothing reads. A method output is always drawn, because the end of a chain
 * - a Result Selection, or a DFM nobody has picked yet - is what the diagram
 * is for; a name missing from the index is drawn too, so the dangling edge to
 * it stays visible.
 */
export function dependencyGraphHiddenByDefault(graph) {
  const hidden = new Set();
  for (const node of graph.nodes) {
    if (node.kind.family === "method" || node.kind.family === "missing") continue;
    if (!node.dependents.length) hidden.add(node.key);
  }
  return hidden;
}

/**
 * The graph without a set of nodes: every remaining node keeps only the
 * precedents and dependents that are still drawn, and every edge touching a
 * removed node goes with it.
 */
export function pruneDependencyGraph(graph, hiddenKeys) {
  if (!hiddenKeys?.size) return graph;
  const byKey = new Map();
  const nodes = [];
  for (const node of graph.nodes) {
    if (hiddenKeys.has(node.key)) continue;
    const copy = {
      ...node,
      precedents: node.precedents.filter((key) => !hiddenKeys.has(key)),
      dependents: node.dependents.filter((key) => !hiddenKeys.has(key)),
    };
    byKey.set(copy.key, copy);
    nodes.push(copy);
  }
  const edges = graph.edges.filter((edge) => !hiddenKeys.has(edge.source) && !hiddenKeys.has(edge.target));
  return { nodes, edges, byKey };
}

/**
 * Marks the edges that close a cycle, walking from every node in input order.
 *
 * A saved class has no cycles, but a half-written link can make one, and a
 * diagram must still draw then: the closing edge is left out of the layering
 * and drawn dashed instead of hanging the layout.
 */
function backEdgeIds(graph) {
  const back = new Set();
  const state = new Map();
  for (const root of graph.nodes) {
    if (state.has(root.key)) continue;
    const stack = [[root.key, 0]];
    state.set(root.key, "open");
    while (stack.length) {
      const frame = stack[stack.length - 1];
      const node = graph.byKey.get(frame[0]);
      if (frame[1] < node.dependents.length) {
        const next = node.dependents[frame[1]];
        frame[1] += 1;
        const seen = state.get(next);
        if (seen === "open") back.add(`${node.key}${next}`);
        else if (!seen) {
          state.set(next, "open");
          stack.push([next, 0]);
        }
      } else {
        state.set(node.key, "done");
        stack.pop();
      }
    }
  }
  return back;
}

function assignLayers(graph, back) {
  const isForward = (source, target) => !back.has(`${source}${target}`);
  const remaining = new Map();
  for (const node of graph.nodes) {
    remaining.set(node.key, node.precedents.filter((source) => isForward(source, node.key)).length);
  }
  const layers = new Map();
  let frontier = graph.nodes.filter((node) => remaining.get(node.key) === 0).map((node) => node.key);
  for (const key of frontier) layers.set(key, 0);
  while (frontier.length) {
    const next = [];
    for (const key of frontier) {
      for (const target of graph.byKey.get(key).dependents) {
        if (!isForward(key, target)) continue;
        layers.set(target, Math.max(layers.get(target) ?? 0, layers.get(key) + 1));
        remaining.set(target, remaining.get(target) - 1);
        if (remaining.get(target) === 0) next.push(target);
      }
    }
    frontier = next;
  }
  return layers;
}

function orderLayers(graph, layers) {
  const columns = [];
  for (const node of graph.nodes) {
    const layer = layers.get(node.key);
    (columns[layer] ||= []).push(node.key);
  }
  const position = new Map();
  const reposition = () => {
    for (const column of columns) column.forEach((key, index) => position.set(key, index));
  };
  reposition();
  const barycenter = (key, field) => {
    const neighbors = graph.byKey.get(key)[field].filter((other) => position.has(other));
    if (!neighbors.length) return position.get(key);
    return neighbors.reduce((sum, other) => sum + position.get(other), 0) / neighbors.length;
  };
  const sortColumn = (column, field) => {
    const ranked = column.map((key, index) => ({ key, index, value: barycenter(key, field) }));
    ranked.sort((a, b) => a.value - b.value || a.index - b.index);
    column.splice(0, column.length, ...ranked.map((item) => item.key));
    column.forEach((key, index) => position.set(key, index));
  };
  for (let sweep = 0; sweep < BARYCENTER_SWEEPS; sweep += 1) {
    if (sweep % 2 === 0) {
      for (let layer = 1; layer < columns.length; layer += 1) sortColumn(columns[layer], "precedents");
    } else {
      for (let layer = columns.length - 2; layer >= 0; layer -= 1) sortColumn(columns[layer], "dependents");
    }
  }
  return columns;
}

function edgePath(source, target) {
  const sx = source.x + source.width;
  const sy = source.y + source.height / 2;
  const tx = target.x;
  const ty = target.y + target.height / 2;
  const reach = Math.max(40, Math.abs(tx - sx) / 2);
  return `M${sx} ${sy}C${sx + reach} ${sy},${tx - reach} ${ty},${tx} ${ty}`;
}

/**
 * Positions every node and routes every edge.
 *
 * Layer is the longest chain of inputs behind a node, so a dataset sits left
 * of everything computed from it; rows inside a layer are ordered by the
 * average row of their neighbours to keep edges short; each column is centred
 * on the tallest one.
 */
export function layoutDependencyGraph(graph, metrics = {}) {
  const nodeWidth = metrics.nodeWidth || DEPENDENCY_GRAPH_NODE_WIDTH;
  const nodeHeight = metrics.nodeHeight || DEPENDENCY_GRAPH_NODE_HEIGHT;
  const columnGap = metrics.columnGap ?? DEPENDENCY_GRAPH_COLUMN_GAP;
  const rowGap = metrics.rowGap ?? DEPENDENCY_GRAPH_ROW_GAP;
  const margin = metrics.margin ?? DEPENDENCY_GRAPH_MARGIN;

  const back = backEdgeIds(graph);
  const layers = assignLayers(graph, back);
  const columns = orderLayers(graph, layers);
  const tallest = columns.reduce((max, column) => Math.max(max, column.length), 0);
  const rowPitch = nodeHeight + rowGap;
  const columnPitch = nodeWidth + columnGap;

  const placed = new Map();
  const nodes = [];
  columns.forEach((column, layer) => {
    const top = margin + ((tallest - column.length) * rowPitch) / 2;
    column.forEach((key, row) => {
      const node = {
        ...graph.byKey.get(key),
        layer,
        row,
        x: margin + layer * columnPitch,
        y: top + row * rowPitch,
        width: nodeWidth,
        height: nodeHeight,
      };
      placed.set(key, node);
      nodes.push(node);
    });
  });
  const edges = graph.edges.map((edge) => ({
    ...edge,
    back: back.has(`${edge.source}${edge.target}`),
    path: edgePath(placed.get(edge.source), placed.get(edge.target)),
  }));
  return {
    nodes,
    edges,
    width: columns.length ? margin * 2 + columns.length * columnPitch - columnGap : 0,
    height: tallest ? margin * 2 + tallest * rowPitch - rowGap : 0,
  };
}
