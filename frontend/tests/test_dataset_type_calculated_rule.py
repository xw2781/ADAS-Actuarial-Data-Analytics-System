from __future__ import annotations

import sys
import unittest
from pathlib import Path
from unittest.mock import patch


FRONTEND_ROOT = Path(__file__).resolve().parents[1]
if str(FRONTEND_ROOT) not in sys.path:
    sys.path.insert(0, str(FRONTEND_ROOT))

from app_server.services import calculated_dataset_service, dataset_service


# ArcRho's library flags "F 35" calculated, but its formula names "C 91",
# a ResQ type ArcRho never imported, so nothing could ever rebuild it.
ROWS = [
    {"name": "Net Loss--Paid", "data_format": "Triangle", "category": "Loss", "calculated": True, "formula": '"Gross Loss--Paid"', "source": "", "generated": True},
    {"name": "Claim Counts--CWP", "data_format": "Triangle", "category": "Counts", "calculated": False, "formula": "", "source": "", "generated": True},
    {"name": "H 06 - Net Paid per CWP", "data_format": "Vector", "category": "Severity", "calculated": True, "formula": '"Net Loss--Paid" / "Claim Counts--CWP" * 1000', "source": "", "generated": False},
    {"name": "F 35 - Claim Count x Severity", "data_format": "Vector", "category": "Loss", "calculated": True, "formula": '"C 91 - Current Qtr Indicated" * "H 06 - Net Paid per CWP" / 1000', "source": "", "generated": False},
]


class DatasetTypeCalculatedRuleTests(unittest.TestCase):
    def setUp(self) -> None:
        patcher = patch.object(calculated_dataset_service, "_dataset_type_rows", return_value=[dict(row) for row in ROWS])
        patcher.start()
        self.addCleanup(patcher.stop)

    def test_unresolvable_type_has_no_calculated_contract(self) -> None:
        self.assertIsNotNone(calculated_dataset_service.calculated_dataset_contract("Demo", "H 06 - Net Paid per CWP"))
        self.assertIsNone(calculated_dataset_service.calculated_dataset_contract("Demo", "F 35 - Claim Count x Severity"))
        self.assertIsNone(calculated_dataset_service.calculated_dataset_dependency_names("Demo", "F 35 - Claim Count x Severity"))

    def test_unresolvable_type_is_nobody_s_dependent_and_no_walk_target(self) -> None:
        self.assertEqual(calculated_dataset_service._direct_dependent_names("Demo", "H 06 - Net Paid per CWP"), [])
        self.assertEqual(calculated_dataset_service._direct_dependent_names("Demo", "Net Loss--Paid"), ["H 06 - Net Paid per CWP"])
        self.assertEqual(calculated_dataset_service._downstream_keys("Demo", ["H 06 - Net Paid per CWP"]), [])
        self.assertNotIn("f 35 - claim count x severity", calculated_dataset_service._calculated_rows_by_key("Demo"))
        result = calculated_dataset_service.recalculate_dataset("Demo", "Auto", "F 35 - Claim Count x Severity")
        self.assertEqual(result["reason"], "not_calculated")

    def test_sidecar_writer_treats_unresolvable_type_as_input_without_a_formula(self) -> None:
        calculation_map = dataset_service._dataset_type_calculation_map("Demo")
        self.assertEqual(dataset_service._is_app_calculated_dataset_type("Demo", "F 35 - Claim Count x Severity", calculation_map=calculation_map), (False, ""))
        self.assertEqual(
            dataset_service._is_app_calculated_dataset_type("Demo", "H 06 - Net Paid per CWP", calculation_map=calculation_map),
            (True, '"Net Loss--Paid" / "Claim Counts--CWP" * 1000'),
        )
        # A generated type keeps the Engine's formula for display.
        self.assertEqual(
            dataset_service._is_app_calculated_dataset_type("Demo", "Net Loss--Paid", calculation_map=calculation_map),
            (False, '"Gross Loss--Paid"'),
        )


if __name__ == "__main__":
    unittest.main()
