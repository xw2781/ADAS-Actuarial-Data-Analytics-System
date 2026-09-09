# ArcRho Macro Source

`python-api/macros` is the source of truth for ArcRho macros maintained by agents.

## Macro metadata and versions

Every active macro Python file directly in this folder must include these fields in
its `<arcrho-macro>` metadata block:

```text
# Version: 1.0.0
# Release Note: Briefly explain what changed from the previous version.
```

Every active macro must also name the Flight Deck icon it should arrive with:

```text
# Icon: calculator
```

- The value is one short name from the Flight Deck's built-in glyph catalog in
  `frontend/ui/flight_deck/flight_deck_icons.js` (for example `calculator`,
  `document`, `chart`, `download`, `upload`, `sync`, `layers`, `gear`, `table`).
- The name decides only the icon a *new* Flight Deck button starts with, so every
  user who loads the macro from the shared library gets the same button. A user
  who then changes their own button keeps their choice: the icon is stored with
  the button, and the macro never overwrites it.
- A missing name, or one the catalog does not hold, falls back to the glyph for
  the macro's `Scope`.
- `frontend/tests/flight_deck.test.mjs` fails if an active macro here names no
  icon or names one the catalog does not hold.

- Use semantic versions in `major.minor.patch` form.
- `Release Note` must be a short, non-empty, single-line string describing the
  current version's change from the immediately preceding version. For a new
  macro, describe it as the initial release.
- Increment the version whenever the macro code or metadata changes.
- Before replacing an existing version, copy it without modification to
  `backup/<macro-file-stem>/<version>/<macro-file-name>`.
- Archived versions are immutable historical records. They are not active macros
  and must not be deployed to the user macro directory.

The `backup/` directory is only for prior macro versions. Its structure and rules
are documented in `backup/README.md`.

## Retired macros

`archive/` holds macros that were withdrawn from service and are kept only as a
reference copy. They are no longer maintained: do not update them, version them,
deploy them, or publish them. `publish_macro_library.py` reads only the active
`*.py` files directly in this folder, so nothing under `archive/` reaches the
shared library. Retiring a macro also means deleting its published copy from the
shared library, which keeps its own copy under `<library>/archive/`. See
`archive/README.md`.

## Deployment

After adding or editing a macro here, deploy every macro in this folder to:

```text
C:\Users\xwei.PRCINS\Documents\ArcRho\macros
```

Keep the deployed copies byte-for-byte aligned with these source files.
Only deploy the active `*.py` files directly in this folder; do not deploy anything
under `backup/`.

## Shared macro library

`publish_macro_library.py` publishes active macros from this folder to the
official shared server macro library (default `E:\ArcRho Server\shared\macros`,
override with `--library-dir` or `ARCRHO_MACRO_LIBRARY_DIR`). The ArcRho app's
Macro Library window reads that folder so users can copy ("load") macros into
their local macro folder; macros never run from the share directly. Once a
macro is loaded it keeps itself current: the app replaces the local copy
whenever the library holds a strictly newer `Version`, both when the Macros
panel lists macros and again just before one runs, so bumping the version here
and publishing is all it takes to put a fix in front of every user. The same
command also publishes the canonical `python-api/migration` Python modules as
an immutable release under `E:\ArcRho Server\shared\python-api\releases` and
atomically switches `shared\python-api\current.json`; ResQ macros load this
read-only support bundle on Client PCs without a development checkout.

The script validates the `Version`/`Release Note` metadata, archives each
replaced library copy to `<library>/archive/<macro-file-stem>/<version>/`, and
replaces library files atomically. Use `--only <file.py>` (repeatable) to
publish selected macros and `--dry-run` to preview. Keep the library folder
writable by deployers only and read-only for users.

After adding or editing any active macro, always also publish the active
macros to the shared library:

```text
python publish_macro_library.py
```
