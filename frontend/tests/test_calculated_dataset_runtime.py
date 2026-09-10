from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch


FRONTEND_ROOT = Path(__file__).resolve().parents[1]
if str(FRONTEND_ROOT) not in sys.path:
    sys.path.insert(0, str(FRONTEND_ROOT))

from app_server import config
from app_server.services import (
    arcrho_runtime_service,
    calculated_dataset_service,
    engine_calculation_service,
)


class CalculatedDatasetRuntimeTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp_dir = tempfile.TemporaryDirectory(dir=str(FRONTEND_ROOT))
        self.cache_dir = (
            Path(self.temp_dir.name)
            / "data"
            / "Example RC"
            / config.DATASET_CACHE_DIR
        )
        self.cache_dir.mkdir(parents=True)
        self.pairs = [
            ("Function", "ArcRhoTri"),
            ("Path", "Example RC"),
            ("DatasetName", "Calculated Output"),
            ("InstanceName", "Calculated Output"),
            ("ProjectName", "Example Project"),
            ("Cumulative", "True"),
            ("Calendar", "False"),
            ("OriginLength", "12"),
            ("DevelopmentLength", "12"),
        ]

    def tearDown(self) -> None:
        self.temp_dir.cleanup()

    def test_dependency_errors_include_structured_missing_names(self) -> None:
        row = {
            "name": "Calculated Output",
            "data_format": "Triangle",
            "formula": '"Generated Input" * 2',
            "calculated": True,
            "generated": False,
        }
        # The type exists in the library; only its instance file is missing.
        input_row = {
            "name": "Generated Input",
            "data_format": "Triangle",
            "formula": "",
            "calculated": False,
            "generated": True,
        }
        with (
            patch.object(calculated_dataset_service, "_dataset_type_rows", return_value=[input_row, row]),
            patch.object(calculated_dataset_service, "_existing_target_settings", return_value={}),
            patch.object(
                calculated_dataset_service,
                "_load_components",
                return_value=({}, [], ["Missing dependency: Generated Input"]),
            ),
        ):
            result = calculated_dataset_service.recalculate_dataset(
                "Example Project",
                "Example RC",
                "Calculated Output",
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["missing_dependencies"], ["Generated Input"])

    def test_failed_calculated_step_blocks_its_downstream_and_keeps_rs_in_review(self) -> None:
        rows = [
            {"name": "Source", "calculated": False, "generated": False, "formula": ""},
            {"name": "Calculated A", "calculated": True, "generated": False, "formula": "Source"},
            {"name": "Calculated B", "calculated": True, "generated": False, "formula": "Calculated A"},
        ]
        with (
            patch.object(calculated_dataset_service, "_dataset_type_rows", return_value=rows),
            patch.object(
                calculated_dataset_service,
                "_existing_downstream_keys",
                return_value=["calculated a", "calculated b"],
            ),
            patch.object(
                calculated_dataset_service,
                "recalculate_dataset",
                return_value={
                    "ok": False,
                    "dataset_type_name": "Calculated A",
                    "reason": "formula_error",
                    "errors": ["bad formula"],
                },
            ) as recalculate,
            patch.object(
                calculated_dataset_service.dataset_sidecar_status_service,
                "refresh_method_statuses_for_dependents",
                return_value=[],
            ),
            patch("app_server.services.result_selection_service.refresh_dependents", return_value={
                "ok": True,
                "updated": [],
                "errors": [],
            }) as refresh_rs,
            patch.object(calculated_dataset_service.dataset_instance_index_service, "rebuild_index"),
        ):
            result = calculated_dataset_service.recalculate_dependents(
                "Example Project",
                "Example RC",
                "Source",
                "Source",
            )

        self.assertFalse(result["ok"])
        recalculate.assert_called_once_with(
            "Example Project",
            "Example RC",
            "Calculated A",
            dataset_type_rows=rows,
            mark_dependents_review=False,
        )
        self.assertEqual(result["skipped"][1]["reason"], "upstream_calculation_failed")
        refresh_rs.assert_called_once_with(
            "Example Project",
            "Example RC",
            ["Source", "Source"],
            rebuild_index=False,
            allow_status_current=True,
            blocked_precedent_names=["Calculated A", "Calculated B"],
            unchanged_precedent_names=[],
            finalize_method_review_status=False,
        )

    def test_calculated_exception_does_not_abort_an_independent_branch(self) -> None:
        rows = [
            {"name": "Source", "calculated": False, "generated": False, "formula": ""},
            {"name": "Broken", "calculated": True, "generated": False, "formula": "Source"},
            {"name": "Broken Child", "calculated": True, "generated": False, "formula": "Broken"},
            {"name": "Healthy", "calculated": True, "generated": False, "formula": "Source"},
        ]

        def recalculate(_project, _reserving, name, **_kwargs):
            if name == "Broken":
                raise OSError("network write failed")
            return {"ok": True, "dataset_type_name": name}

        with (
            patch.object(calculated_dataset_service, "_dataset_type_rows", return_value=rows),
            patch.object(
                calculated_dataset_service,
                "_existing_downstream_keys",
                return_value=["broken", "broken child", "healthy"],
            ),
            patch.object(calculated_dataset_service, "recalculate_dataset", side_effect=recalculate),
            patch.object(
                calculated_dataset_service.dataset_sidecar_status_service,
                "refresh_method_statuses_for_dependents",
                return_value=[],
            ),
            patch("app_server.services.result_selection_service.refresh_dependents", return_value={
                "ok": True,
                "updated": [],
                "errors": [],
            }) as refresh_rs,
            patch.object(calculated_dataset_service.dataset_instance_index_service, "rebuild_index"),
        ):
            result = calculated_dataset_service.recalculate_dependents(
                "Example Project", "Example RC", "Source", "Source",
            )

        self.assertFalse(result["ok"])
        self.assertEqual(result["updated"], [{
            "ok": True,
            "dataset_type_name": "Healthy",
            "status": "updated",
        }])
        self.assertEqual(result["skipped"][0]["reason"], "calculation_error")
        self.assertEqual(result["skipped"][1]["reason"], "upstream_calculation_failed")
        refresh_rs.assert_called_once_with(
            "Example Project",
            "Example RC",
            ["Source", "Source", "Healthy"],
            rebuild_index=False,
            allow_status_current=True,
            blocked_precedent_names=["Broken", "Broken Child"],
            unchanged_precedent_names=[],
            finalize_method_review_status=False,
        )

    def test_recalculation_preserves_registered_result_selection_dependent(self) -> None:
        row = {
            "name": "Calculated Output",
            "data_format": "Vector",
            "formula": "Source",
            "calculated": True,
            "generated": False,
        }
        source_row = {
            "name": "Source",
            "data_format": "Vector",
            "formula": "",
            "calculated": False,
            "generated": False,
        }
        csv_path = self.cache_dir / "Calculated Output@12.csv"
        sidecar_path = self.cache_dir.parent / config.DATASET_SIDECAR_DIR / "Calculated Output.json"
        sidecar_path.parent.mkdir(parents=True)
        sidecar_path.write_text(json.dumps({
            "dataset_name": "Calculated Output",
            "dataset_type": "Calculated Output",
            "project_name": "Example Project",
            "reserving_class": "Example RC",
            "dependents": [{"dataset_name": "Selection"}],
        }), encoding="utf-8")

        with (
            patch.object(calculated_dataset_service, "_calculated_rows_by_key", return_value={"calculated output": row}),
            patch.object(calculated_dataset_service, "_dataset_type_rows", return_value=[source_row, row]),
            patch.object(calculated_dataset_service, "_existing_target_settings", return_value={}),
            patch.object(
                calculated_dataset_service,
                "_load_components",
                return_value=({"_d0": [[1.0], [2.0]]}, ["Source"], []),
            ),
            patch.object(
                calculated_dataset_service,
                "_target_paths",
                return_value=(str(csv_path), str(sidecar_path)),
            ),
            patch.object(
                calculated_dataset_service,
                "sidecar_graph_fields",
                return_value={
                    "precedents": [{"dataset_name": "Source"}],
                    "dependents": [{"dataset_name": "Formula Output"}],
                },
            ),
            patch.object(
                calculated_dataset_service.dataset_sidecar_status_service,
                "read_sidecar",
                return_value={"method_type": "Result Selection", "source_kind": "result_selection"},
            ),
            patch.object(
                calculated_dataset_service.dataset_sidecar_status_service,
                "sidecar_path",
                return_value=str(sidecar_path),
            ),
            patch.object(
                calculated_dataset_service.dataset_sidecar_status_service,
                "refresh_method_statuses_for_dependents",
                return_value=[],
            ),
            patch.dict(config.DATASETS, {}, clear=True),
        ):
            result = calculated_dataset_service.recalculate_dataset(
                "Example Project",
                "Example RC",
                "Calculated Output",
            )

        self.assertTrue(result["ok"], result)
        saved = json.loads(sidecar_path.read_text(encoding="utf-8"))
        self.assertEqual(saved["dependents"], [
            {"dataset_name": "Formula Output"},
            {"dataset_name": "Selection"},
        ])

    def test_missing_app_calculated_cache_is_rebuilt_before_engine_request(self) -> None:
        calculated_path = str(
            self.cache_dir / "Calculated Output@12@12@cum@dev.csv"
        )
        with (
            patch.object(
                arcrho_runtime_service,
                "resolve_local_triangle_cache",
                return_value={"ok": False, "status": "cache_missing"},
            ),
            patch.object(
                calculated_dataset_service,
                "calculated_dataset_contract",
                return_value={
                    "name": "Calculated Output",
                    "formula": '"Input" * 2',
                    "precedents": [],
                    "precedent_contracts": {},
                },
            ),
            patch.object(
                calculated_dataset_service,
                "recalculate_dataset",
                return_value={"ok": True, "path": calculated_path},
            ) as recalculate,
            patch.object(
                arcrho_runtime_service,
                "_recalculate_dependents_after_cache_write",
                return_value={"ok": True, "steps": []},
            ),
            patch.object(
                arcrho_runtime_service,
                "_register_arcrho_dataset",
                return_value="arcrhotri_calculated",
            ),
            patch.object(
                arcrho_runtime_service.dataset_instance_index_service,
                "rebuild_index",
            ),
            patch.object(
                engine_calculation_service,
                "send_request_like_vba",
                side_effect=AssertionError("app-calculated datasets must not be sent to the data engine"),
            ),
        ):
            result = arcrho_runtime_service.run_arcrho_tri(
                self.pairs,
                calculated_path,
                timeout_sec=1.0,
                write_sidecar=False,
            )

        self.assertTrue(result["ok"], result)
        self.assertEqual(result["local_cache_status"], "calculated")
        self.assertEqual(result["ds_id"], "arcrhotri_calculated")
        self.assertTrue(result["sidecar_written"])
        recalculate.assert_called_once_with(
            "Example Project",
            "Example RC",
            "Calculated Output",
            component_paths={},
        )

    def test_new_engine_cache_skips_dependents_without_sidecar_write(self) -> None:
        generated_path = str(
            self.cache_dir / "Generated Input@12@12@cum@dev.csv"
        )
        with (
            patch.object(
                arcrho_runtime_service,
                "resolve_local_triangle_cache",
                return_value={
                    "ok": False,
                    "status": "cache_missing",
                    "manual_source_found": False,
                    "generated_source_found": True,
                },
            ),
            patch.object(arcrho_runtime_service, "_recalculate_requested_app_dataset", return_value=None),
            patch.object(arcrho_runtime_service, "arcrho_tri_cache_matches", return_value=False),
            patch.object(arcrho_runtime_service.os, "makedirs"),
            patch.object(engine_calculation_service, "send_request_like_vba", return_value="request.txt"),
            patch.object(engine_calculation_service, "wait_for_file", return_value=True),
            patch.object(
                arcrho_runtime_service,
                "_require_runtime_cache_provenance",
                return_value=True,
            ),
            patch.object(arcrho_runtime_service, "_refresh_dataset_instance_index_after_cache_write"),
            patch.object(arcrho_runtime_service, "_register_arcrho_dataset", return_value="arcrhotri_generated"),
            patch.object(
                arcrho_runtime_service,
                "_recalculate_dependents_after_cache_write",
            ) as recalculate_dependents,
        ):
            result = arcrho_runtime_service.run_arcrho_tri(
                self.pairs,
                generated_path,
                timeout_sec=1.0,
                write_sidecar=False,
            )

        self.assertTrue(result["ok"], result)
        self.assertTrue(result["need_request"])
        self.assertFalse(result["sidecar_written"])
        self.assertIsNone(result["calculated_updates"])
        self.assertTrue(result["cache_provenance_recorded"])
        recalculate_dependents.assert_not_called()

    def test_generated_dependency_is_materialized_before_calculation(self) -> None:
        calculated_path = str(
            self.cache_dir / "Calculated Output@12@12@cum@dev.csv"
        )
        with (
            patch.object(
                arcrho_runtime_service,
                "resolve_local_triangle_cache",
                return_value={"ok": False, "status": "cache_missing"},
            ),
            patch.object(
                calculated_dataset_service,
                "calculated_dataset_contract",
                return_value={
                    "name": "Calculated Output",
                    "formula": '"Generated Input" * 2',
                    "precedents": ["Generated Input"],
                    "precedent_contracts": {
                        "generated input": {
                            "name": "Generated Input",
                            "data_format": "Triangle",
                            "generated": True,
                        },
                    },
                },
            ),
            patch.object(
                calculated_dataset_service,
                "recalculate_dataset",
                return_value={"ok": True, "path": calculated_path},
            ) as recalculate,
            patch.object(
                arcrho_runtime_service,
                "_materialize_calculated_dependencies",
                return_value=[{"ok": True, "dataset_type_name": "Generated Input"}],
            ) as materialize,
            patch.object(
                arcrho_runtime_service,
                "_recalculate_dependents_after_cache_write",
                return_value={"ok": True, "steps": []},
            ),
            patch.object(
                arcrho_runtime_service,
                "_register_arcrho_dataset",
                return_value="arcrhotri_calculated",
            ),
            patch.object(
                arcrho_runtime_service.dataset_instance_index_service,
                "rebuild_index",
            ),
        ):
            result = arcrho_runtime_service.run_arcrho_tri(
                self.pairs,
                calculated_path,
                timeout_sec=1.0,
                write_sidecar=False,
            )

        self.assertTrue(result["ok"], result)
        self.assertEqual(recalculate.call_count, 1)
        materialize.assert_called_once()

    def test_dfm_outputs_that_held_are_handed_to_result_selection_as_unchanged(self) -> None:
        rows = [{"name": "Source", "calculated": False, "generated": False, "formula": ""}]
        dfm_wave = {
            "ok": True,
            "updated": [
                {"dataset_name": "C 12 - CWP DFM", "dataset_type": "C 12 - CWP DFM", "output_changed": False},
                {"dataset_name": "C 32 - Reported DFM", "dataset_type": "C 32 - Reported DFM", "output_changed": True},
            ],
            "status_refreshed": [{"dataset_name": "C 42 - Reported ex CWOP DFM"}],
            "skipped": [{"dataset_name": "F 13 - Paid DFM", "reason": "not_updated"}],
            "errors": [],
        }
        with (
            patch.object(calculated_dataset_service, "_dataset_type_rows", return_value=rows),
            patch.object(calculated_dataset_service, "_existing_downstream_keys", return_value=[]),
            patch.object(calculated_dataset_service, "_refresh_link_driven_dependents", return_value=[]),
            patch.object(
                calculated_dataset_service.dataset_sidecar_status_service,
                "refresh_method_statuses_for_dependents",
                return_value=[],
            ),
            patch("app_server.services.dfm_service.refresh_dependents", return_value=dfm_wave),
            patch("app_server.services.result_selection_service.refresh_dependents", return_value={
                "ok": True,
                "updated": [],
                "errors": [],
            }) as refresh_rs,
            patch.object(calculated_dataset_service.dataset_instance_index_service, "rebuild_index"),
        ):
            result = calculated_dataset_service.recalculate_dependents(
                "Example Project",
                "Example RC",
                "Source",
                "Source",
                include_berquist_sherman=False,
                include_bornhuetter_ferguson=False,
                include_cape_cod=False,
                include_bootstrap=False,
            )

        self.assertTrue(result["ok"], result)
        refresh_rs.assert_called_once_with(
            "Example Project",
            "Example RC",
            ["Source", "Source", "C 32 - Reported DFM", "C 32 - Reported DFM"],
            rebuild_index=False,
            allow_status_current=True,
            blocked_precedent_names=[],
            unchanged_precedent_names=[
                "C 12 - CWP DFM",
                "C 12 - CWP DFM",
                "C 42 - Reported ex CWOP DFM",
                "F 13 - Paid DFM",
            ],
            finalize_method_review_status=False,
        )


if __name__ == "__main__":
    unittest.main()
