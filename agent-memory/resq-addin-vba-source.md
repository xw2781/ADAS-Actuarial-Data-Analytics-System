---
name: resq-addin-vba-source
description: The ResQ Excel add-in's full VBA source is readable and extracted to E:\XWSpace\ResQ API Doc\vba — a working reference implementation of the ResQ COM API
metadata:
  type: reference
---

The ResQ Excel add-in (`E:\XWSpace\ResQ API Doc\ResQ.xlam`) carries its VBA source in plain
compressed form. The VBE password (`resq`) only locks the editor UI, so no password is needed to
read it: `olevba` extracts every module directly. Extracted on 2026-09-09 to
`E:\XWSpace\ResQ API Doc\vba\` (11 modules, ~3,486 lines).

`oletools` is not installed in any of this machine's Python environments; install it to a scratch
folder and point `PYTHONPATH` at it, then use `oletools.olevba.VBA_Parser.extract_macros()`.

**Why:** it is a vendor-written, working reference implementation of the ResQ COM API — the exact
member names, call order, load/unload discipline, and unit conventions ResQ itself expects. That
is the same ground truth we otherwise reverse-engineer with live COM probes (see
[[resq-com-probe]] and [[resq-com-probe-dont-call-blindly]]).

**How to apply:** before probing ResQ COM for how to read something, grep
`E:\XWSpace\ResQ API Doc\vba\GeneralFunctions.bas` first. It covers triangles, vectors, DFM
patterns, project settings, node/project contents, cashflows, Result Selection contents and
movements, and Bootstrap reserves. Notably `ResQDFMPattern` reads `aDFM.MonthlyPattern(i * length)`
against `MonthlyPatternCount`, confirming that ResQ stores the pattern monthly and samples it at
the development length — consistent with [[origin-length-is-not-row-count]].
