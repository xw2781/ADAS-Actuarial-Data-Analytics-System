from __future__ import annotations

from typing import Any, Dict, List

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

from app_server.api.local_client import require_local_client
from app_server.schemas.scripting import (
    ScriptRunRequest,
    ScriptDeleteVarRequest,
    ScriptNotebookSaveRequest,
    ScriptNotebookLoadRequest,
    ScriptInspectRequest,
    ScriptMacroRunRequest,
    ScriptMacroSourceRunRequest,
    ScriptMacroDeleteRequest,
    ScriptMacroLibraryInstallRequest,
    ScriptMacroRenameRequest,
    ScriptTaskWrapperSaveRequest,
)
from app_server.services import (
    macro_library_service,
    scripting_macro_service,
    scripting_notebook_service,
    scripting_preferences_service,
    scripting_service,
)

router = APIRouter()
_SESSION_HEADER = "X-Scripting-Session-Id"


def _session_id_from_request(request: Request) -> str | None:
    raw = request.headers.get(_SESSION_HEADER)
    if raw is None:
        return None
    sid = raw.strip()
    return sid or None


@router.post("/scripting/run")
def scripting_run(req: ScriptRunRequest, request: Request) -> Dict[str, Any]:
    return scripting_service.run_script(req.code, _session_id_from_request(request))


@router.post("/scripting/run-stream")
def scripting_run_stream(req: ScriptRunRequest, request: Request) -> StreamingResponse:
    stream = scripting_service.run_script_stream(req.code, _session_id_from_request(request))
    return StreamingResponse(stream, media_type="application/x-ndjson")


@router.post("/scripting/interrupt")
def scripting_interrupt(request: Request) -> Dict[str, Any]:
    return scripting_service.interrupt_execution(_session_id_from_request(request))


@router.get("/scripting/variables")
def scripting_variables(request: Request) -> List[Dict[str, Any]]:
    return scripting_service.get_variables(_session_id_from_request(request))


@router.post("/scripting/del-variable")
def scripting_del_variable(req: ScriptDeleteVarRequest, request: Request) -> Dict[str, Any]:
    return scripting_service.del_variable(req.name, _session_id_from_request(request))


@router.post("/scripting/reset")
def scripting_reset(request: Request) -> Dict[str, Any]:
    return scripting_service.reset_session(_session_id_from_request(request))


@router.post("/scripting/save-notebook")
def scripting_save_notebook(req: ScriptNotebookSaveRequest) -> Dict[str, Any]:
    return scripting_notebook_service.save_notebook(req.filename, req.cells)


@router.post("/scripting/load-notebook")
def scripting_load_notebook(req: ScriptNotebookLoadRequest) -> Dict[str, Any]:
    return scripting_notebook_service.load_notebook(req.filename)


@router.get("/scripting/notebooks")
def scripting_list_notebooks() -> List[Dict[str, str]]:
    return scripting_notebook_service.list_notebooks()


@router.get("/scripting/macros")
def scripting_list_macros() -> List[Dict[str, Any]]:
    return scripting_macro_service.list_macros()


@router.get("/scripting/macro-library")
def scripting_list_macro_library() -> Dict[str, Any]:
    return macro_library_service.list_library_macros()


@router.post("/scripting/macro-library/install")
def scripting_install_library_macro(req: ScriptMacroLibraryInstallRequest) -> Dict[str, Any]:
    return macro_library_service.install_library_macro(req.macro_id, overwrite=req.overwrite)


@router.post("/scripting/macro-library/sync")
def scripting_sync_library_macros() -> Dict[str, Any]:
    return macro_library_service.sync_library_updates()


@router.post("/scripting/run-macro")
def scripting_run_macro(req: ScriptMacroRunRequest) -> Dict[str, Any]:
    return scripting_macro_service.run_macro(
        req.macro_id,
        req.active_context,
        task_window_id=req.task_window_id,
        task_session_id=req.task_session_id,
        task_mode=req.task_mode,
    )


@router.post("/scripting/run-in-arcrho")
def scripting_run_in_arcrho(req: ScriptMacroSourceRunRequest, request: Request) -> Dict[str, Any]:
    require_local_client(request, "Run in ArcRho")
    return scripting_macro_service.run_macro_source_in_arcrho(
        req.source,
        req.filename,
        req.source_path,
    )


@router.post("/scripting/delete-macro")
def scripting_delete_macro(req: ScriptMacroDeleteRequest) -> Dict[str, Any]:
    return scripting_macro_service.delete_macro(req.macro_id)


@router.post("/scripting/rename-macro")
def scripting_rename_macro(req: ScriptMacroRenameRequest) -> Dict[str, Any]:
    return scripting_macro_service.rename_macro(req.macro_id, req.new_name)


@router.post("/scripting/save-task-wrapper")
def scripting_save_task_wrapper(req: ScriptTaskWrapperSaveRequest) -> Dict[str, Any]:
    return scripting_macro_service.save_task_wrapper_macro(req.title, req.description, req.filename, req.tasks)


@router.post("/scripting/inspect")
def scripting_inspect(req: ScriptInspectRequest, request: Request) -> Dict[str, Any]:
    return scripting_service.inspect_object(req.code, req.cursor_pos, _session_id_from_request(request))


@router.get("/scripting/preferences")
def scripting_get_preferences() -> Dict[str, Any]:
    return scripting_preferences_service.get_preferences()


@router.post("/scripting/preferences")
def scripting_save_preferences(prefs: Dict[str, Any]) -> Dict[str, Any]:
    return scripting_preferences_service.save_preferences(prefs)


@router.get("/local-project/preferences")
def local_project_get_preferences() -> Dict[str, Any]:
    return scripting_preferences_service.get_local_project_preferences()


@router.post("/local-project/preferences")
def local_project_save_preferences(prefs: Dict[str, Any]) -> Dict[str, Any]:
    return scripting_preferences_service.save_local_project_preferences(prefs)


@router.get("/scripting/api-help")
def scripting_api_help() -> List[Dict[str, str]]:
    return scripting_service.get_api_help()
