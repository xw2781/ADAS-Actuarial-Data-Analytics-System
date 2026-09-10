import sys
import unittest
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from arcrho_api.dataset_type_contract import (
    dataset_type_key,
    dataset_type_keys,
    is_app_calculated_dataset_type,
    quoted_formula_names,
)


ROWS = [
    {"name": "Net Loss--Paid", "calculated": True, "generated": True, "formula": '"Gross Loss--Paid " + "Recoveries--Received"'},
    {"name": "Claim Counts--CWP", "calculated": False, "generated": True, "formula": ""},
    {"name": "H 06 - Net Paid per CWP", "calculated": True, "generated": False, "formula": '"Net Loss--Paid" / "Claim Counts--CWP" * 1000'},
    {"name": "F 35 - Claim Count * Severity", "calculated": True, "generated": False, "formula": '"C 91 - Current Qtr Indicated" * "H 06 - Net Paid per CWP" / 1000'},
    {"name": "Prior Qtr Indicated", "calculated": False, "generated": False, "formula": '"Current Qtr Indicated"'},
    {"name": "Adjusted*", "calculated": True, "generated": False, "formula": "   "},
]
KEYS = dataset_type_keys(ROWS)


def _row(name: str) -> dict:
    return next(row for row in ROWS if row["name"] == name)


class DatasetTypeContractTests(unittest.TestCase):
    def test_key_ignores_quotes_outer_space_inner_runs_and_case(self) -> None:
        self.assertEqual(dataset_type_key('  "Gross  Loss--Paid " '), "gross loss--paid")
        self.assertEqual(dataset_type_key(None), "")

    def test_quoted_names_come_back_in_order_once_each(self) -> None:
        self.assertEqual(
            quoted_formula_names('"A" * ("B" + "A") / "b"'),
            ["A", "B"],
        )
        self.assertEqual(quoted_formula_names("Earned Premium + Remaining Budget Premium"), [])

    def test_calculated_type_over_known_types_is_app_calculated(self) -> None:
        self.assertTrue(is_app_calculated_dataset_type(_row("H 06 - Net Paid per CWP"), KEYS))

    def test_calculated_type_naming_a_type_the_table_lacks_is_an_input(self) -> None:
        self.assertFalse(is_app_calculated_dataset_type(_row("F 35 - Claim Count * Severity"), KEYS))
        self.assertTrue(is_app_calculated_dataset_type(_row("F 35 - Claim Count * Severity"), KEYS | {"c 91 - current qtr indicated"}))

    def test_generated_unflagged_and_blank_formula_rows_are_never_app_calculated(self) -> None:
        self.assertFalse(is_app_calculated_dataset_type(_row("Net Loss--Paid"), KEYS))
        self.assertFalse(is_app_calculated_dataset_type(_row("Claim Counts--CWP"), KEYS))
        self.assertFalse(is_app_calculated_dataset_type(_row("Prior Qtr Indicated"), KEYS))
        self.assertFalse(is_app_calculated_dataset_type(_row("Adjusted*"), KEYS))


if __name__ == "__main__":
    unittest.main()
