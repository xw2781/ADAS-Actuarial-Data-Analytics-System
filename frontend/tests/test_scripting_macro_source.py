from __future__ import annotations

import copy
import sys
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

REPO_ROOT = Path(__file__).resolve().parents[2]
# Every test temp directory lives under one gitignored folder at the
# repository root, so a suite that dies before teardown cannot scatter
# tmp folders beside the code.
TEST_TEMP_ROOT = REPO_ROOT / "test"
TEST_TEMP_ROOT.mkdir(parents=True, exist_ok=True)
sys.path.insert(0, str(REPO_ROOT / "frontend"))
if str(REPO_ROOT / "python-api" / "src") not in sys.path:
    sys.path.insert(0, str(REPO_ROOT / "python-api" / "src"))

from app_server.services import scripting_macro_service


class _FakeDfm:
    def __init__(self) -> None:
        self.payload = {"value": 1}

    def to_dict(self):
        return copy.deepcopy(self.payload)


class MacroSourceExecutionTests(unittest.TestCase):
    def test_macro_worker_initializes_and_uninitializes_com_on_its_execution_thread(self) -> None:
        events = []
        com_apartment = Mock()
        com_apartment.CoUninitialize.side_effect = lambda: events.append(
            ("uninitialize", threading.get_ident())
        )

        def initialize():
            events.append(("initialize", threading.get_ident()))
            return com_apartment

        source = "import threading\nprint(f'runner={threading.get_ident()}')"
        with (
            patch.object(scripting_macro_service, "_initialize_macro_com_apartment", side_effect=initialize),
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
        ):
            result = scripting_macro_service.run_macro_source(source, "com_macro.py", {})

        runner_thread = int(result["stdout"].strip().split("=", 1)[1])
        self.assertTrue(result["success"], result)
        self.assertEqual(events, [
            ("initialize", runner_thread),
            ("uninitialize", runner_thread),
        ])

    def test_apply_growth_adjustments_is_valid_unregistered_macro_source(self) -> None:
        # A retired macro, kept as a frozen fixture: it exercises the source
        # runner against a real macro file without being maintained itself.
        macro_path = Path(__file__).resolve().parents[2] / "python-api" / "macros" / "archive" / "apply_growth_adjustments.py"
        source = macro_path.read_text(encoding="utf-8-sig")
        namespace = {"__name__": "__arcrho_macro_contract_test__", "__file__": str(macro_path)}

        exec(compile(source, str(macro_path), "exec"), namespace)

        self.assertTrue(callable(namespace.get("run_macro")))
        self.assertRegex(namespace.get("_REVIEW_QUARTER", ""), r"^\d{4}Q[1-4]$")

        smoke_source = source + """
def run_macro(active_dfm, active_context=None):
    print(f"loaded {_REVIEW_QUARTER}")
    return {'message': 'apply_growth_adjustments loaded in source runner'}
"""
        with patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()):
            result = scripting_macro_service.run_macro_source(
                smoke_source,
                macro_path.name,
                {},
                source_path=str(macro_path),
            )
        self.assertTrue(result["success"])
        self.assertIn("apply_growth_adjustments loaded", result["message"])
        self.assertRegex(result["stdout"], r"loaded \d{4}Q[1-4]")

    def test_run_macro_source_invokes_buffer_entry_point_with_live_context(self) -> None:
        dfm = _FakeDfm()
        source = """
def run_macro(active_dfm, active_context):
    print(f"context={active_context['label']}")
    active_dfm.payload['value'] = 7
    return {'message': 'updated live DFM'}
"""
        with (
            patch.object(scripting_macro_service, "_build_active_dfm", return_value=dfm),
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
        ):
            result = scripting_macro_service.run_macro_source(
                source,
                "feature.py",
                {"activeJson": {"details_tab": {}}, "label": "live"},
                source_path=r"E:\work\feature.py",
            )

        self.assertTrue(result["success"])
        self.assertEqual(result["payload"]["value"], 7)
        self.assertEqual(result["message"], "updated live DFM")
        self.assertIn("context=live", result["stdout"])
        self.assertEqual(result["path"], r"E:\work\feature.py")

    def test_run_macro_source_supports_zero_argument_main_and_returned_payload(self) -> None:
        source = """
def main():
    return {'payload': {'from_main': True}}
"""
        with patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()):
            result = scripting_macro_service.run_macro_source(source, "scratch.py", {})

        self.assertTrue(result["success"])
        self.assertEqual(result["payload"], {"from_main": True})

    def test_run_macro_source_does_not_emit_payload_for_no_op_script(self) -> None:
        dfm = _FakeDfm()
        with (
            patch.object(scripting_macro_service, "_build_active_dfm", return_value=dfm),
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
        ):
            result = scripting_macro_service.run_macro_source(
                "print('inspection only')",
                "inspect_only.py",
                {"activeJson": {"details_tab": {}}},
            )

        self.assertTrue(result["success"])
        self.assertNotIn("payload", result)
        self.assertIn("inspection only", result["stdout"])

    def test_macro_update_notes_carried_in_payload_metadata(self) -> None:
        class _NotesDfm:
            def __init__(self) -> None:
                self.payload = {"details_tab": {"name": "Development"}}
                self._pending_notes = None

            def to_dict(self):
                return copy.deepcopy(self.payload)

            def update_notes(self, text):
                self._pending_notes = str(text or "")
                return self

        dfm = _NotesDfm()
        source = """
def run_macro(active_dfm, active_context=None):
    active_dfm.update_notes("Generated adjustment note")
    return {'message': 'notes updated'}
"""
        with (
            patch.object(scripting_macro_service, "_build_active_dfm", return_value=dfm),
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
        ):
            result = scripting_macro_service.run_macro_source(
                source,
                "notes_macro.py",
                {"activeJson": {"details_tab": {}}},
            )

        self.assertTrue(result["success"], result)
        # Even though the method payload itself is unchanged, the pending notes
        # ride in the transient `method metadata.method notes` carrier so the
        # DFM tab can deliver them to the Notes tab on apply.
        self.assertEqual(result["payload"]["method_metadata"]["method_notes"], "Generated adjustment note")
        self.assertEqual(result["payload"]["details_tab"], {"name": "Development"})

    def test_build_active_dfm_accepts_dirty_ui_payload_with_stale_revisions(self) -> None:
        from arcrho_api.dfm_contract import recalculate_dfm_method

        saved = recalculate_dfm_method(
            {
                "details_tab": {
                    "name": "Development",
                    "output_type": "Selected Ultimate",
                    "output_dataset": "Development Output",
                    "input_triangle": "Paid",
                    "origin_length": 12,
                    "development_length": 12,
                },
                "ratios_tab": {
                    "average_formulas": {
                        "label": ["User Entry"],
                        "custom_average_formula_settings": {"average_type": ["user_entry"]},
                        "selected": [[1, 1]],
                        "values": [[1.5, 1]],
                        "inputs": [["1.5", "1"]],
                    },
                },
            },
            input_snapshot={
                "name": "Paid",
                "data_format": "Triangle",
                "origin_labels": ["2024", "2025"],
                "development_labels": ["12", "24"],
                "values": [[100, 150], [200, None]],
                "mask": [[True, True], [True, False]],
                "number_format": "#,##0",
                "decimal_places": 0,
                "revision": "paid-r1",
            },
            timestamp="2026-01-01T00:00:00Z",
        )
        dirty = copy.deepcopy(saved)
        formula = '= "Simple - 2" * [Accounting Cutoff][-1]'
        # Simulate an unsaved UI edit: the owned content changes while the
        # payload still carries the revision stamps of the last save.
        dirty["ratios_tab"]["average_formulas"]["inputs"][0][0] = formula

        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as temp_dir, patch.object(
            scripting_macro_service.tempfile, "gettempdir", return_value=temp_dir
        ):
            dfm = scripting_macro_service._build_active_dfm({"activeJson": dirty, "fields": {}})

        self.assertEqual(dfm.average_formulas["inputs"][0][0], formula)

        # The UI stamps its live Notes tab text on the transient carrier so the
        # macro reads the dirty notes instead of the persisted sidecar.
        dirty.setdefault("method_metadata", {})["method_notes"] = "Unsaved UI note"
        with tempfile.TemporaryDirectory(dir=TEST_TEMP_ROOT) as temp_dir, patch.object(
            scripting_macro_service.tempfile, "gettempdir", return_value=temp_dir
        ):
            seeded_dfm = scripting_macro_service._build_active_dfm({"activeJson": dirty, "fields": {}})

        self.assertEqual(seeded_dfm.notes, "Unsaved UI note")
        self.assertEqual(seeded_dfm._macro_seeded_notes, "Unsaved UI note")
        self.assertNotIn("method_notes", seeded_dfm.payload.get("method_metadata", {}))

    def test_untouched_seeded_notes_are_not_re_emitted_as_a_payload_carrier(self) -> None:
        class _SeededNotesDfm:
            def __init__(self) -> None:
                self.payload = {"details_tab": {"name": "Development"}}
                self._pending_notes = "Unsaved UI note"
                self._macro_seeded_notes = "Unsaved UI note"

            def to_dict(self):
                return copy.deepcopy(self.payload)

            def update_notes(self, text):
                self._pending_notes = str(text or "")
                return self

        dfm = _SeededNotesDfm()
        with (
            patch.object(scripting_macro_service, "_build_active_dfm", return_value=dfm),
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
        ):
            result = scripting_macro_service.run_macro_source(
                "print('inspection only')",
                "read_notes.py",
                {"activeJson": {"details_tab": {}}},
            )

        self.assertTrue(result["success"], result)
        self.assertNotIn("payload", result)

        dfm = _SeededNotesDfm()
        source = """
def run_macro(active_dfm, active_context=None):
    active_dfm.update_notes("Unsaved UI note\\n\\nGenerated adjustment note")
    return {'message': 'notes updated'}
"""
        with (
            patch.object(scripting_macro_service, "_build_active_dfm", return_value=dfm),
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
        ):
            result = scripting_macro_service.run_macro_source(
                source,
                "notes_macro.py",
                {"activeJson": {"details_tab": {}}},
            )

        self.assertEqual(
            result["payload"]["method_metadata"]["method_notes"],
            "Unsaved UI note\n\nGenerated adjustment note",
        )

    def test_run_macro_source_times_out_runaway_python(self) -> None:
        with (
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
            patch.object(scripting_macro_service, "_MACRO_TIMEOUT_SEC", 0.05),
        ):
            result = scripting_macro_service.run_macro_source("while True:\n    pass", "runaway.py", {})

        self.assertFalse(result["success"])
        self.assertIn("timeout", result["message"])

    def test_run_macro_source_extends_timeout_when_activity_is_reported(self) -> None:
        source = """
import time
for _ in range(4):
    report_macro_activity()
    time.sleep(0.03)
"""
        with (
            patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()),
            patch.object(scripting_macro_service, "_MACRO_TIMEOUT_SEC", 0.05),
        ):
            result = scripting_macro_service.run_macro_source(source, "active_import.py", {})

        self.assertTrue(result["success"], result)

    def test_run_macro_source_trusted_call_suspends_and_restores_trace(self) -> None:
        source = """
import sys

trace_before = sys.gettrace()
trace_inside = run_trusted_macro_call(sys.gettrace)

def fail_while_untraced():
    assert sys.gettrace() is None
    raise ValueError("expected")

try:
    run_trusted_macro_call(fail_while_untraced)
except ValueError:
    pass

print(f"suspended={trace_inside is None}")
print(f"restored={sys.gettrace() is trace_before}")
"""
        with patch.object(scripting_macro_service, "_MacroTaskDesignerProxy", return_value=Mock()):
            result = scripting_macro_service.run_macro_source(source, "trusted_call.py", {})

        self.assertTrue(result["success"], result)
        self.assertIn("suspended=True", result["stdout"])
        self.assertIn("restored=True", result["stdout"])

    def test_cooperative_macro_cancel_checker_raises_when_signalled(self) -> None:
        cancel_event = threading.Event()
        check_macro_cancelled = scripting_macro_service._make_cooperative_cancel_checker(cancel_event)

        check_macro_cancelled()
        cancel_event.set()

        with self.assertRaisesRegex(KeyboardInterrupt, "cancelled by user"):
            check_macro_cancelled()

    def test_registered_macro_delegates_to_canonical_source_runner(self) -> None:
        from app_server.services import macro_library_service

        with (
            patch.object(scripting_macro_service, "_safe_macro_path", return_value=r"E:\macros\registered.py"),
            patch.object(scripting_macro_service.os.path, "isfile", return_value=True),
            patch.object(Path, "read_text", return_value="def main(): pass"),
            patch.object(macro_library_service, "sync_library_macro", return_value=None) as sync,
            patch.object(scripting_macro_service, "run_macro_source", return_value={"success": True}) as runner,
        ):
            result = scripting_macro_service.run_macro("registered.py", {"activeJson": {}})

        self.assertTrue(result["success"])
        self.assertNotIn("library_update", result)
        sync.assert_called_once_with("registered.py")
        runner.assert_called_once_with(
            "def main(): pass",
            "registered.py",
            {"activeJson": {}},
            source_path=r"E:\macros\registered.py",
            task_window_id="",
            task_session_id="",
            task_mode="",
        )

    def test_registered_macro_takes_the_newer_library_version_before_it_runs(self) -> None:
        from app_server.services import macro_library_service

        update = {"macro_id": "registered.py", "name": "Registered", "version": "2.0.0", "local_version": "1.0.0"}
        order: list[str] = []
        with (
            patch.object(scripting_macro_service, "_safe_macro_path", return_value=r"E:\macros\registered.py"),
            patch.object(scripting_macro_service.os.path, "isfile", return_value=True),
            patch.object(macro_library_service, "sync_library_macro", side_effect=lambda _id: (order.append("sync"), update)[1]),
            patch.object(Path, "read_text", side_effect=lambda *a, **k: (order.append("read"), "def main(): pass")[1]),
            patch.object(scripting_macro_service, "run_macro_source", return_value={"success": True}),
        ):
            result = scripting_macro_service.run_macro("registered.py", {"activeJson": {}})

        # The replacement happens before the source is read, so the copy that
        # runs is the library version.
        self.assertEqual(order, ["sync", "read"])
        self.assertEqual(result["library_update"], update)

    def test_arcrho_bridge_captures_executes_and_applies(self) -> None:
        capture = {
            "ok": True,
            "result": {
                "activeContext": {"activeJson": {"details_tab": {}}},
                "target": {"token": "capture-token", "tabId": "dfm-1"},
            },
        }
        review = {"ok": True, "result": {"applied": True, "message": "Applied."}}
        with (
            patch("app_server.services.ui_automation_service.submit_command", side_effect=[capture, review]) as submit,
            patch.object(
                scripting_macro_service,
                "run_macro_source",
                return_value={
                    "success": True,
                    "message": "Ran feature.py",
                    "stdout": "done\n",
                    "payload": {"value": 2},
                },
            ) as execute,
        ):
            result = scripting_macro_service.run_macro_source_in_arcrho(
                "def run_macro(active_dfm, active_context): pass",
                "feature.py",
                r"E:\work\feature.py",
            )

        self.assertTrue(result["success"])
        self.assertTrue(result["applied"])
        self.assertNotIn("payload", result)
        self.assertEqual(submit.call_args_list[0].args[0], "macro.captureActiveDfmContext")
        self.assertEqual(submit.call_args_list[1].args[0], "macro.reviewAndApplyResult")
        self.assertEqual(submit.call_args_list[1].args[2]["target"]["token"], "capture-token")
        self.assertGreater(submit.call_args_list[1].args[2]["expiresAt"], 0)
        execute.assert_called_once()

    def test_arcrho_bridge_allows_ui_only_source_without_active_dfm(self) -> None:
        capture = {
            "ok": True,
            "result": {
                "activeContext": {"available": False, "pageType": "home"},
                "target": {"token": "ui-token", "kind": "ui"},
            },
        }
        review = {"ok": True, "result": {"applied": False, "message": "UI script completed."}}
        with (
            patch("app_server.services.ui_automation_service.submit_command", side_effect=[capture, review]),
            patch.object(
                scripting_macro_service,
                "run_macro_source",
                return_value={"success": True, "message": "Ran ui_only.py", "stdout": "shown\n"},
            ) as execute,
        ):
            result = scripting_macro_service.run_macro_source_in_arcrho("print('shown')", "ui_only.py")

        self.assertTrue(result["success"])
        self.assertFalse(result["applied"])
        self.assertEqual(execute.call_args.args[2]["pageType"], "home")


if __name__ == "__main__":
    unittest.main()
