from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from app_server import config
from app_server.services import macro_library_service
from app_server.services.scripting_macro_service import _parse_macro_metadata


def _macro_source(version: str, note: str = "Initial release.", body: str = "print('hi')") -> str:
    return (
        "# <arcrho-macro>\n"
        "# Title: Sample Macro\n"
        f"# Version: {version}\n"
        f"# Release Note: {note}\n"
        "# Description: A sample macro.\n"
        "# Scope: DFM\n"
        "# </arcrho-macro>\n"
        f"{body}\n"
    )


class MacroLibraryServiceTests(unittest.TestCase):
    def setUp(self) -> None:
        # Temp dirs must stay inside the repository per validation rules.
        self._tmp = tempfile.TemporaryDirectory(dir=str(Path(__file__).resolve().parent))
        root = Path(self._tmp.name)
        self.library_dir = root / "library"
        self.macro_dir = root / "macros"
        self.library_dir.mkdir()
        self.macro_dir.mkdir()
        self._old_macro_dir = config.MACRO_DIR
        self._old_library_dir = config.MACRO_LIBRARY_DIR
        config.MACRO_DIR = str(self.macro_dir)
        config.MACRO_LIBRARY_DIR = str(self.library_dir)

    def tearDown(self) -> None:
        config.MACRO_DIR = self._old_macro_dir
        config.MACRO_LIBRARY_DIR = self._old_library_dir
        self._tmp.cleanup()

    def test_parse_macro_metadata_reads_version_and_release_note(self) -> None:
        meta = _parse_macro_metadata(_macro_source("1.2.5", "Fixed a bug."), "sample.py")
        self.assertEqual(meta["version"], "1.2.5")
        self.assertEqual(meta["release_note"], "Fixed a bug.")

    def test_parse_macro_metadata_reads_the_declared_flight_deck_icon(self) -> None:
        source = _macro_source("1.0.0").replace("# Scope: DFM\n", "# Scope: DFM\n# Icon: Calculator\n")
        self.assertEqual(_parse_macro_metadata(source, "sample.py")["icon"], "calculator")
        # A macro naming nothing, or something that is not a short name, leaves the choice
        # to the Flight Deck rather than reaching it as a glyph name it cannot use.
        self.assertEqual(_parse_macro_metadata(_macro_source("1.0.0"), "sample.py")["icon"], "")
        odd = _macro_source("1.0.0").replace("# Scope: DFM\n", "# Scope: DFM\n# Icon: <svg onload=x>\n")
        self.assertEqual(_parse_macro_metadata(odd, "sample.py")["icon"], "")

    def test_list_reports_unreachable_library(self) -> None:
        config.MACRO_LIBRARY_DIR = str(self.library_dir / "missing")
        result = macro_library_service.list_library_macros()
        self.assertFalse(result["available"])
        self.assertEqual(result["macros"], [])
        self.assertIn("not reachable", result["message"])

    def test_list_statuses_cover_install_states(self) -> None:
        (self.library_dir / "not_installed.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.library_dir / "up_to_date.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.macro_dir / "up_to_date.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.library_dir / "update_available.py").write_text(_macro_source("1.1.0"), encoding="utf-8")
        (self.macro_dir / "update_available.py").write_text(_macro_source("1.0.9"), encoding="utf-8")
        (self.library_dir / "local_differs.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.macro_dir / "local_differs.py").write_text(
            _macro_source("1.0.0", body="print('edited locally')"), encoding="utf-8"
        )
        # Non-macro entries at the top level and archived versions are ignored.
        (self.library_dir / "notes.txt").write_text("ignore me", encoding="utf-8")
        archive = self.library_dir / "archive" / "old" / "0.9.0"
        archive.mkdir(parents=True)
        (archive / "old.py").write_text(_macro_source("0.9.0"), encoding="utf-8")

        result = macro_library_service.list_library_macros()
        self.assertTrue(result["available"])
        statuses = {item["id"]: item["status"] for item in result["macros"]}
        self.assertEqual(statuses, {
            "not_installed.py": "not_installed",
            "up_to_date.py": "up_to_date",
            "update_available.py": "update_available",
            "local_differs.py": "local_differs",
        })
        by_id = {item["id"]: item for item in result["macros"]}
        self.assertEqual(by_id["update_available.py"]["version"], "1.1.0")
        self.assertEqual(by_id["update_available.py"]["local_version"], "1.0.9")
        self.assertEqual(by_id["not_installed.py"]["local_version"], "")

    def test_up_to_date_ignores_line_ending_differences(self) -> None:
        source = _macro_source("1.0.0")
        (self.library_dir / "sample.py").write_bytes(source.replace("\n", "\r\n").encode("utf-8"))
        (self.macro_dir / "sample.py").write_text(source, encoding="utf-8")
        result = macro_library_service.list_library_macros()
        self.assertEqual(result["macros"][0]["status"], "up_to_date")

    def test_install_copies_library_macro_byte_for_byte(self) -> None:
        payload = _macro_source("1.2.0").encode("utf-8")
        (self.library_dir / "sample.py").write_bytes(payload)
        result = macro_library_service.install_library_macro("sample.py")
        self.assertTrue(result["success"], result)
        self.assertTrue(result["installed"])
        self.assertEqual(result["version"], "1.2.0")
        self.assertEqual((self.macro_dir / "sample.py").read_bytes(), payload)

    def test_install_identical_copy_reports_up_to_date(self) -> None:
        source = _macro_source("1.0.0")
        (self.library_dir / "sample.py").write_text(source, encoding="utf-8")
        (self.macro_dir / "sample.py").write_text(source, encoding="utf-8")
        result = macro_library_service.install_library_macro("sample.py")
        self.assertTrue(result["success"])
        self.assertFalse(result["installed"])
        self.assertIn("already up to date", result["message"])

    def test_install_conflict_requires_confirmation_then_overwrites(self) -> None:
        (self.library_dir / "sample.py").write_text(_macro_source("2.0.0"), encoding="utf-8")
        (self.macro_dir / "sample.py").write_text(
            _macro_source("1.0.0", body="print('local edit')"), encoding="utf-8"
        )
        blocked = macro_library_service.install_library_macro("sample.py")
        self.assertFalse(blocked["success"])
        self.assertTrue(blocked["needs_confirmation"])
        self.assertEqual(blocked["local_version"], "1.0.0")
        self.assertEqual(blocked["version"], "2.0.0")

        replaced = macro_library_service.install_library_macro("sample.py", overwrite=True)
        self.assertTrue(replaced["success"], replaced)
        self.assertEqual(
            (self.macro_dir / "sample.py").read_text(encoding="utf-8"),
            _macro_source("2.0.0"),
        )

    def test_install_missing_library_macro_fails(self) -> None:
        result = macro_library_service.install_library_macro("missing.py")
        self.assertFalse(result["success"])
        self.assertIn("not found in library", result["message"])

    def test_install_rejects_path_traversal_ids(self) -> None:
        (self.library_dir / "sample.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        result = macro_library_service.install_library_macro("..\\..\\sample.py")
        # Traversal segments are stripped to the basename, so this resolves
        # inside the library and never escapes either folder.
        self.assertTrue(result["success"], result)
        self.assertTrue((self.macro_dir / "sample.py").is_file())
        self.assertFalse((self.macro_dir.parent / "sample.py").exists())

    def test_sync_replaces_only_a_local_copy_the_library_outversions(self) -> None:
        (self.library_dir / "newer.py").write_text(_macro_source("1.1.0"), encoding="utf-8")
        (self.macro_dir / "newer.py").write_text(
            _macro_source("1.0.0", body="print('edited locally')"), encoding="utf-8"
        )
        (self.library_dir / "current.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.macro_dir / "current.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.library_dir / "edited.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.macro_dir / "edited.py").write_text(
            _macro_source("1.0.0", body="print('edited locally')"), encoding="utf-8"
        )
        (self.library_dir / "not_loaded.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.macro_dir / "mine.py").write_text(_macro_source("1.0.0"), encoding="utf-8")

        result = macro_library_service.sync_library_updates()

        self.assertTrue(result["available"])
        self.assertEqual([entry["macro_id"] for entry in result["updated"]], ["newer.py"])
        self.assertEqual(result["updated"][0]["version"], "1.1.0")
        self.assertEqual(result["updated"][0]["local_version"], "1.0.0")
        self.assertEqual(result["updated"][0]["name"], "Sample Macro")
        # A local edit at the same version is not a library update, and a
        # library macro that was never loaded is not loaded by a sync.
        self.assertEqual((self.macro_dir / "newer.py").read_text(encoding="utf-8"), _macro_source("1.1.0"))
        self.assertIn("edited locally", (self.macro_dir / "edited.py").read_text(encoding="utf-8"))
        self.assertFalse((self.macro_dir / "not_loaded.py").exists())
        self.assertEqual(macro_library_service.sync_library_updates()["updated"], [])

    def test_sync_one_macro_reads_only_that_library_file(self) -> None:
        (self.library_dir / "sample.py").write_text(_macro_source("2.0.0"), encoding="utf-8")
        (self.macro_dir / "sample.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        (self.library_dir / "other.py").write_text(_macro_source("2.0.0"), encoding="utf-8")
        (self.macro_dir / "other.py").write_text(_macro_source("1.0.0"), encoding="utf-8")

        result = macro_library_service.sync_library_macro("sample.py")

        self.assertEqual(result["version"], "2.0.0")
        self.assertEqual(result["local_version"], "1.0.0")
        self.assertEqual((self.macro_dir / "sample.py").read_text(encoding="utf-8"), _macro_source("2.0.0"))
        self.assertEqual((self.macro_dir / "other.py").read_text(encoding="utf-8"), _macro_source("1.0.0"))
        self.assertIsNone(macro_library_service.sync_library_macro("sample.py"))
        self.assertIsNone(macro_library_service.sync_library_macro("mine.py"))

    def test_sync_one_macro_leaves_a_copy_alone_when_the_library_is_unreachable(self) -> None:
        (self.macro_dir / "sample.py").write_text(_macro_source("1.0.0"), encoding="utf-8")
        config.MACRO_LIBRARY_DIR = str(self.library_dir / "missing")
        self.assertIsNone(macro_library_service.sync_library_macro("sample.py"))
        config.MACRO_LIBRARY_DIR = ""
        self.assertIsNone(macro_library_service.sync_library_macro("sample.py"))
        self.assertEqual((self.macro_dir / "sample.py").read_text(encoding="utf-8"), _macro_source("1.0.0"))


if __name__ == "__main__":
    unittest.main()
