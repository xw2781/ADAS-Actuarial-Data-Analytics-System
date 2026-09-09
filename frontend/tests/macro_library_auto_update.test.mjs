import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("The macro library requests and the overwrite prompt have one owner", () => {
  const client = read("../ui/macro/macro_library_client.js");
  const library = read("../ui/macro/macro_library_window.js");
  const macro = read("../ui/macro/macro_window.js");

  assert.match(client, /\/scripting\/macro-library`/);
  assert.match(client, /\/scripting\/macro-library\/install`/);
  assert.match(client, /\/scripting\/macro-library\/sync`, \{ method: "POST" \}/);
  assert.match(client, /needs_confirmation/);
  assert.match(client, /new CustomEvent\("arcrho:local-macros-changed"\)/);
  // Neither window may talk to the library or re-ask the overwrite question.
  for (const source of [library, macro]) {
    assert.doesNotMatch(source, /\/scripting\/macro-library/);
    assert.doesNotMatch(source, /needs_confirmation/);
  }
  assert.match(library, /copyLibraryMacroToLocal, fetchLibraryMacros/);
  assert.match(macro, /import \{ syncLibraryMacros \} from "\.\/macro_library_client\.js/);
});

test("A loaded macro the library outversions is replaced without a click", () => {
  const client = read("../ui/macro/macro_library_client.js");
  const macro = read("../ui/macro/macro_window.js");
  const css = read("../ui/macro/macro_window.css");
  const interactions = read("../ui/macro/macro_list_interactions.js");

  // The sync never asks: a replaced copy is announced through the same event a
  // load raises, and nothing is announced when there was nothing to replace.
  assert.match(client, /if \(updated\.length\) window\.dispatchEvent\(new CustomEvent\("arcrho:local-macros-changed"\)\)/);
  // The panel syncs after the local list is on screen and names what changed.
  assert.match(macro, /setMacroStatus\(`\$\{liveMacros\.length\} macro\(s\) available\.`\);\s*\n\s*void applyMacroLibraryUpdates\(\);/);
  assert.match(macro, /updated = await syncLibraryMacros\(\);/);
  assert.match(macro, /if \(updated\.length\) setMacroStatus\(libraryUpdateMessage\(updated\), "", \{ statusBar: true \}\);/);
  // An unreachable library leaves the list as it is.
  assert.match(macro, /\} catch \{\s*\n\s*return;\s*\n\s*\}/);
  // The stamp and the row control it needed are gone with it.
  for (const source of [macro, css, interactions]) {
    assert.doesNotMatch(source, /macroUpdateStamp|macroListItemAction/);
  }
  assert.doesNotMatch(macro, /LIBRARY_STATUS_UPDATE_AVAILABLE|copyLibraryMacroToLocal|fetchLibraryMacros/);
});

test("A run reports the library version the app server swapped in first", () => {
  const macro = read("../ui/macro/macro_window.js");

  assert.match(macro, /if \(result\?\.library_update\) \{\s*\n\s*setMacroStatus\(libraryUpdateMessage\(\[result\.library_update\]\), "", \{ statusBar: true \}\);\s*\n\s*window\.dispatchEvent\(new CustomEvent\("arcrho:local-macros-changed"\)\);/);
});

test("Both macro windows refresh from the same local-macros event", () => {
  const library = read("../ui/macro/macro_library_window.js");
  const macro = read("../ui/macro/macro_window.js");

  assert.match(library, /addEventListener\("arcrho:local-macros-changed"[\s\S]*?loadLibraryMacros\(\)/);
  assert.match(macro, /addEventListener\("arcrho:local-macros-changed"[\s\S]*?loadMacros\(\)/);
});
