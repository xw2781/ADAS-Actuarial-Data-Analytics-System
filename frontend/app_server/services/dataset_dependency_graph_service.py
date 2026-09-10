"""The whole dependency graph of one reserving class, for the Dependency Graph window.

Every object in a class - an input dataset, a calculated or Engine-built one,
and the output dataset each method publishes - is a row of the class index and
owns a sidecar whose ``precedents`` name what it is computed from. The index
is therefore the node list, with the type, method, status, and formula each
node is drawn with, and the sidecars are the edge list. Nothing is derived
from method JSON here: a method's inputs are already written into its output
sidecar when the method is saved, which is the same graph every dependent
walk follows.
"""
from __future__ import annotations

from typing import Any, Dict, List

from fastapi import HTTPException

from app_server.helpers import _canon_dataset_name
from app_server.services import dataset_instance_index_service
from app_server.services import dataset_sidecar_status_service as status_service


def _clean_text(value: Any) -> str:
    return str(value if value is not None else "").strip()


def build_reserving_class_dependency_graph(project_name: str, reserving_class: str) -> Dict[str, Any]:
    """Nodes in index order and ``precedent -> dataset`` edges, deduplicated and sorted.

    A precedent the index does not list - a name a sidecar still carries after
    its dataset was deleted - keeps its edge and becomes a node with no
    metadata, so the diagram shows the dangling reference instead of hiding it.
    """

    project = _clean_text(project_name)
    rc = _clean_text(reserving_class)
    if not project or not rc:
        raise HTTPException(400, "project_name and reserving_class are required.")

    index = dataset_instance_index_service.get_index(project, rc)
    rows = index.get("files") if isinstance(index, dict) else None
    nodes: List[Dict[str, Any]] = []
    display_names: Dict[str, str] = {}
    for row in rows or []:
        name = _clean_text(row.get("name")) if isinstance(row, dict) else ""
        key = _canon_dataset_name(name)
        if not key or key in display_names:
            continue
        display_names[key] = name
        nodes.append({
            "name": name,
            "dataset_type": _clean_text(row.get("dataset_type")) or name,
            "source_kind": _clean_text(row.get("source_kind")),
            "method_type": status_service.normalize_method_type(
                row.get("method_type"), row.get("source_kind")
            ),
            "method_name": _clean_text(row.get("method_name")),
            "status": status_service.normalize_status(row.get("status")),
            "formula": _clean_text(row.get("formula")),
            "in_index": True,
        })

    sidecars = status_service.read_sidecars(project, rc, list(display_names.values()))
    edge_keys: Dict[tuple, Dict[str, str]] = {}

    def add_edge(source: str, target: str) -> None:
        source_key = _canon_dataset_name(source)
        target_key = _canon_dataset_name(target)
        if not source_key or not target_key or source_key == target_key:
            return
        for key, raw in ((source_key, source), (target_key, target)):
            if key not in display_names:
                display_names[key] = raw
                nodes.append({
                    "name": raw,
                    "dataset_type": raw,
                    "source_kind": "",
                    "method_type": status_service.METHOD_TYPE_NONE,
                    "method_name": "",
                    "status": status_service.STATUS_CURRENT,
                    "formula": "",
                    "in_index": False,
                })
        edge_keys.setdefault(
            (source_key, target_key),
            {"source": display_names[source_key], "target": display_names[target_key]},
        )

    for key, payload in sidecars.items():
        name = display_names[key]
        for precedent in status_service.entry_names(payload.get("precedents")):
            add_edge(precedent, name)
        # The reciprocal side names the same edges; reading it too keeps an
        # edge whose precedent sidecar was written but whose dependent's was not.
        for dependent in status_service.entry_names(payload.get("dependents")):
            add_edge(name, dependent)

    edges = [edge_keys[key] for key in sorted(edge_keys)]
    return {
        "ok": True,
        "project_name": project,
        "reserving_class": rc,
        "nodes": nodes,
        "edges": edges,
    }
