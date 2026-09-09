"""Shared macro library on the ArcRho Server workspace.

Lists the deployer-managed read-only library folder and copies ("loads")
selected macros into the user's local macro folder, which remains the only
place the Macro panel runs macros from. A local copy the library holds a
strictly newer version of is replaced on its own: for every loaded macro when
the Macros panel lists them, and for the one macro about to run, so a user
always runs the latest published version. Metadata parsing and local macro
path safety are delegated to scripting_macro_service so there is a single
owner for both.
"""
from __future__ import annotations

import os
import tempfile
from concurrent.futures import ThreadPoolExecutor
from typing import Any, Dict, List, Optional, Tuple

from app_server import config
from app_server.services.scripting_macro_service import (
    _parse_macro_metadata,
    _safe_macro_path,
)

# Bounded parallel reads: the library lives on a network share where each
# file read can cost a full round trip.
_LIBRARY_READ_WORKERS = 8
_MAX_LIBRARY_SOURCE_CHARS = 2_000_000

STATUS_NOT_INSTALLED = "not_installed"
STATUS_UP_TO_DATE = "up_to_date"
STATUS_UPDATE_AVAILABLE = "update_available"
STATUS_LOCAL_DIFFERS = "local_differs"


def _get_library_dir() -> str:
    return str(getattr(config, "MACRO_LIBRARY_DIR", "") or "").strip()


def _safe_library_path(macro_id: str) -> str:
    library_dir = os.path.abspath(_get_library_dir())
    if not library_dir:
        raise ValueError("Macro library is not configured.")
    safe_name = os.path.basename(str(macro_id or "").strip().replace("\\", "/"))
    if not safe_name:
        raise ValueError("Macro id is required.")
    if not safe_name.lower().endswith(".py"):
        safe_name = f"{safe_name}.py"
    path = os.path.abspath(os.path.join(library_dir, safe_name))
    if not path.startswith(library_dir + os.sep):
        raise ValueError("Macro path is outside the macro library.")
    return path


def _parse_version(value: Any) -> Optional[Tuple[int, int, int]]:
    parts = str(value or "").strip().split(".")
    if len(parts) != 3:
        return None
    try:
        return (int(parts[0]), int(parts[1]), int(parts[2]))
    except ValueError:
        return None


def _normalize_source(text: str) -> str:
    """Compare macro content ignoring line endings and BOM differences."""
    return str(text or "").replace("\r\n", "\n").replace("\r", "\n").strip()


def _read_macro_file(path: str) -> Optional[str]:
    try:
        with open(path, "r", encoding="utf-8-sig") as f:
            return f.read(_MAX_LIBRARY_SOURCE_CHARS)
    except OSError:
        return None


def _library_status(library_text: str, library_version: str, local_text: Optional[str], local_version: str) -> str:
    if local_text is None:
        return STATUS_NOT_INSTALLED
    if _normalize_source(library_text) == _normalize_source(local_text):
        return STATUS_UP_TO_DATE
    lib_parsed = _parse_version(library_version)
    local_parsed = _parse_version(local_version)
    if lib_parsed is not None and local_parsed is not None:
        if lib_parsed > local_parsed:
            return STATUS_UPDATE_AVAILABLE
        return STATUS_LOCAL_DIFFERS
    if library_version and library_version != local_version:
        return STATUS_UPDATE_AVAILABLE
    return STATUS_LOCAL_DIFFERS


def _list_library_entries(library_dir: str) -> List[str]:
    entries: List[str] = []
    with os.scandir(library_dir) as it:
        for entry in it:
            if entry.is_file() and entry.name.lower().endswith(".py"):
                entries.append(entry.name)
    return sorted(entries, key=str.lower)


def list_library_macros() -> Dict[str, Any]:
    """List the shared library with install/update status per macro."""
    library_dir = _get_library_dir()
    if not library_dir:
        return {"available": False, "message": "Macro library is not configured.", "macros": []}
    if not os.path.isdir(library_dir):
        return {
            "available": False,
            "message": f"Macro library folder is not reachable: {library_dir}",
            "macros": [],
        }
    try:
        entries = _list_library_entries(library_dir)
    except OSError as exc:
        return {
            "available": False,
            "message": f"Macro library folder could not be read: {exc}",
            "macros": [],
        }

    library_paths = [os.path.join(library_dir, entry) for entry in entries]
    with ThreadPoolExecutor(max_workers=_LIBRARY_READ_WORKERS) as pool:
        library_texts = list(pool.map(_read_macro_file, library_paths))

    macros: List[Dict[str, Any]] = []
    for entry, path, text in zip(entries, library_paths, library_texts):
        if text is None:
            continue
        meta = _parse_macro_metadata(text, entry)
        local_text = None
        local_version = ""
        try:
            local_path = _safe_macro_path(entry)
        except ValueError:
            local_path = ""
        if local_path and os.path.isfile(local_path):
            local_text = _read_macro_file(local_path)
            if local_text is not None:
                local_version = _parse_macro_metadata(local_text, entry)["version"]
        macros.append({
            "id": entry,
            "name": meta["title"],
            "description": meta["description"],
            "scope": meta["scope"],
            "scopes": meta["scopes"],
            "version": meta["version"],
            "release_note": meta["release_note"],
            "local_version": local_version,
            "status": _library_status(text, meta["version"], local_text, local_version),
            "path": path,
        })
    return {"available": True, "message": "", "macros": macros}


def install_library_macro(macro_id: str, overwrite: bool = False) -> Dict[str, Any]:
    """Copy a library macro byte-for-byte into the local macro folder atomically."""
    try:
        library_path = _safe_library_path(macro_id)
        local_path = _safe_macro_path(macro_id)
    except ValueError as exc:
        return {"success": False, "message": str(exc)}

    if not os.path.isfile(library_path):
        return {"success": False, "message": f"Macro not found in library: {os.path.basename(library_path)}"}
    try:
        with open(library_path, "rb") as f:
            library_bytes = f.read()
    except OSError as exc:
        return {"success": False, "message": f"Library macro could not be read: {exc}"}
    library_text = library_bytes.decode("utf-8-sig", errors="replace")
    meta = _parse_macro_metadata(library_text, os.path.basename(library_path))
    library_label = f"v{meta['version']}" if meta["version"] else "unversioned"

    local_text = _read_macro_file(local_path) if os.path.isfile(local_path) else None
    if local_text is not None:
        if _normalize_source(local_text) == _normalize_source(library_text):
            return {
                "success": True,
                "installed": False,
                "macro_id": os.path.basename(local_path),
                "version": meta["version"],
                "message": f"{meta['title']} is already up to date.",
            }
        if not overwrite:
            local_version = _parse_macro_metadata(local_text, os.path.basename(local_path))["version"]
            local_label = f"v{local_version}" if local_version else "unversioned"
            return {
                "success": False,
                "needs_confirmation": True,
                "macro_id": os.path.basename(local_path),
                "version": meta["version"],
                "local_version": local_version,
                "message": (
                    f"Your local copy of {os.path.basename(local_path)} ({local_label}) differs "
                    f"from the library version ({library_label})."
                ),
            }

    macro_dir = os.path.dirname(local_path)
    os.makedirs(macro_dir, exist_ok=True)
    try:
        fd, temp_path = tempfile.mkstemp(prefix=".macro_library_", suffix=".tmp", dir=macro_dir)
        try:
            with os.fdopen(fd, "wb") as f:
                f.write(library_bytes)
            os.replace(temp_path, local_path)
        except BaseException:
            try:
                os.remove(temp_path)
            except OSError:
                pass
            raise
    except OSError as exc:
        return {"success": False, "message": f"Could not copy macro to the local macro folder: {exc}"}

    version_suffix = f" v{meta['version']}" if meta["version"] else ""
    return {
        "success": True,
        "installed": True,
        "macro_id": os.path.basename(local_path),
        "name": meta["title"],
        "version": meta["version"],
        "message": f"Loaded {meta['title']}{version_suffix} into your local macros.",
    }


def sync_library_macro(macro_id: str) -> Optional[Dict[str, Any]]:
    """Replace one local macro when the library holds a strictly newer version.

    Reads only that macro's library file, so the check before a run costs one
    share read. Returns the install result when a copy was replaced, otherwise
    None: a macro the library does not hold, an unreachable library, a copy that
    is current, and a local copy that differs at the same or a higher version
    are all left alone.
    """
    try:
        library_path = _safe_library_path(macro_id)
        local_path = _safe_macro_path(macro_id)
    except ValueError:
        return None
    if not os.path.isfile(local_path) or not os.path.isfile(library_path):
        return None
    library_text = _read_macro_file(library_path)
    local_text = _read_macro_file(local_path)
    if library_text is None or local_text is None:
        return None
    name = os.path.basename(library_path)
    library_version = _parse_macro_metadata(library_text, name)["version"]
    local_version = _parse_macro_metadata(local_text, name)["version"]
    if _library_status(library_text, library_version, local_text, local_version) != STATUS_UPDATE_AVAILABLE:
        return None
    result = install_library_macro(macro_id, overwrite=True)
    if not result.get("installed"):
        return None
    result["local_version"] = local_version
    return result


def sync_library_updates() -> Dict[str, Any]:
    """Replace every local macro the library holds a strictly newer version of."""
    listing = list_library_macros()
    updated: List[Dict[str, Any]] = []
    for macro in listing["macros"]:
        if macro["status"] != STATUS_UPDATE_AVAILABLE:
            continue
        result = install_library_macro(macro["id"], overwrite=True)
        if result.get("installed"):
            result["local_version"] = macro["local_version"]
            updated.append(result)
    return {"available": listing["available"], "message": listing["message"], "updated": updated}
