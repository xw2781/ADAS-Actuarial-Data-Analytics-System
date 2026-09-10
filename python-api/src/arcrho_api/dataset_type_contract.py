"""Which rows of a project's dataset-types table ArcRho computes itself.

``dataset_types.json`` flags a type ``Calculated`` and gives it a ``Formula``
over other types, each quoted by name: ``"Net Loss--Paid" / "Claim
Counts--CWP"``. ArcRho rebuilds an instance of such a type from the instances
its formula names, so the instance is read-only in the app, is refreshed by
the dependent-propagation walk, and is hidden from the ResQ transfer review.

That is only possible when every type the formula names is in the table. A
formula naming a type the table lacks -- one ResQ holds and ArcRho never
imported, carried along when the type's formula was copied from ResQ -- can
never be evaluated, and a dataset it left read-only could neither be rebuilt
nor edited. Such a type is therefore not calculated at all: an instance of it
is a plain input holding whatever values it was given, with no formula, no
precedents, and no place in the dependent walk as a target. Only a quoted
name can be unresolved, because an unquoted reference is recognised only
when it matches a type already in the table.

The app server, the ResQ import, and the transfer review decide "calculated"
through :func:`is_app_calculated_dataset_type` and nowhere else.
"""

from __future__ import annotations

import re
from typing import Any, Iterable, Mapping

_QUOTED_NAME_RE = re.compile(r'"([^"]+)"')
_WHITESPACE_RE = re.compile(r"\s+")


def dataset_type_key(name: Any) -> str:
    """One comparison key for a type name: quotes and outer space dropped, inner runs of space collapsed, case ignored."""
    text = str(name if name is not None else "").strip().strip('"').strip("'").strip()
    return _WHITESPACE_RE.sub(" ", text).casefold()


def dataset_type_keys(rows: Iterable[Mapping[str, Any]]) -> frozenset[str]:
    """The keys of every named row, for :func:`is_app_calculated_dataset_type`."""
    return frozenset(key for key in (dataset_type_key(row.get("name")) for row in rows) if key)


def quoted_formula_names(formula: Any) -> list[str]:
    """The double-quoted type names a formula spells out, in order, once each."""
    out: list[str] = []
    seen: set[str] = set()
    for match in _QUOTED_NAME_RE.finditer(str(formula if formula is not None else "")):
        name = match.group(1).strip()
        key = dataset_type_key(name)
        if key and key not in seen:
            seen.add(key)
            out.append(name)
    return out


def is_app_calculated_dataset_type(row: Mapping[str, Any], known_keys: Iterable[str]) -> bool:
    """True when ArcRho rebuilds instances of this type from its formula.

    ``row`` is one parsed table row (``name``, ``calculated``, ``generated``,
    ``formula``); ``known_keys`` is :func:`dataset_type_keys` of the whole
    table. Generated types are the Engine's, not the formula evaluator's.
    """
    formula = str(row.get("formula") if row.get("formula") is not None else "").strip()
    if not row.get("calculated") or row.get("generated") or not formula:
        return False
    keys = known_keys if isinstance(known_keys, (set, frozenset)) else frozenset(known_keys)
    return all(dataset_type_key(name) in keys for name in quoted_formula_names(formula))
