import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

const SQL_EDITOR_PAGES = [
  { name: "snowflake", engine: "snowflake", html: "../ui/arcode/snowflake-console/index.html", js: "../ui/arcode/snowflake-console/index.js" },
  { name: "sql-server", engine: "sqlserver", html: "../ui/arcode/sql-server-console/index.html", js: "../ui/arcode/sql-server-console/index.js" },
];

test("both SQL editors are the generic editor framework in SQL mode", () => {
  const sqlMode = read("../ui/arcode/shared/sql_mode.js");
  assert.match(sqlMode, /export function createSqlEditorPage\(engineId\)/);
  assert.match(sqlMode, /import \{ createEditorPage \} from "\.\/editor_framework\.js\?v=/);

  for (const page of SQL_EDITOR_PAGES) {
    const source = read(page.js);
    const html = read(page.html);
    assert.match(
      source,
      /import \{ createSqlEditorPage \} from "\.\.\/shared\/sql_mode\.js\?v=/,
      `${page.name} imports the shared SQL mode`,
    );
    assert.match(source, new RegExp(`createSqlEditorPage\\("${page.engine}"\\)`), `${page.name} names its engine`);
    // The engine id is the only thing a SQL editor page may vary.
    assert.doesNotMatch(source, /monaco\.editor\.create/, `${page.name} does not create its own editor`);
    assert.doesNotMatch(source, /connectionSelect|runQuery|readTextFile/, `${page.name} restates no runtime behavior`);
    // The framework renders the page, so the document is a host plus scripts.
    assert.match(html, /id="editorRoot"/, `${page.name} hosts the framework chrome`);
    assert.match(html, /shared\/editor_framework\.css\?v=/);
    assert.match(html, /shared\/sql_mode\.css\?v=/);
    assert.doesNotMatch(html, /class="ce-toolbar"|id="runBtn"/, `${page.name} does not restate the command strip`);
  }
});

test("one engine descriptor owns every engine-specific route, field, and label", () => {
  const engines = read("../ui/arcode/shared/sql_engines.js");
  const sqlMode = read("../ui/arcode/shared/sql_mode.js");
  const dialog = read("../ui/arcode/database-connections/dialog.js");

  for (const route of [
    "/snowflake/connections",
    "/snowflake/connections/delete",
    "/snowflake/reset-connection",
    "/snowflake/query",
    "/snowflake/test-connection",
    "/sqlserver/connections",
    "/sqlserver/connections/delete",
    "/sqlserver/reset-connection",
    "/sqlserver/query",
    "/sqlserver/test-connection",
  ]) {
    assert.ok(engines.includes(`"${route}"`), `sql_engines declares ${route}`);
  }

  // Neither consumer may restate a route or a product name of its own.
  for (const source of [sqlMode, dialog]) {
    assert.doesNotMatch(source, /"\/(snowflake|sqlserver)\//);
    assert.doesNotMatch(source, /"(Snowflake|SQL Server)"/);
  }
  assert.match(sqlMode, /engine\.routes\.query/);
  assert.match(sqlMode, /engine\.routes\.reset/);
  assert.match(dialog, /engine\.routes\.save/);
  assert.match(dialog, /engine\.routes\.delete/);
  assert.match(dialog, /engine\.routes\.test/);
});

test("SQL editors run against a connection and reconnect instead of restarting", () => {
  const engines = read("../ui/arcode/shared/sql_engines.js");
  const sqlMode = read("../ui/arcode/shared/sql_mode.js");

  // Run stays disabled until a profile is selected.
  assert.match(sqlMode, /canRun: \(\) => !!connections\[activeConnection\]/);
  // The generic Restart command reads as Reconnect on a SQL page.
  assert.match(sqlMode, /label: engine\.reconnectLabel/);
  assert.match(engines, /reconnectLabel: "Reconnect"/);
  assert.equal((engines.match(/reconnectLabel: "Reconnect"/g) || []).length, 2);
  // Profile editing lives in the shell dialog, not on the page.
  assert.doesNotMatch(sqlMode, /id="manageConnectionsBtn"|connectionForm/);
  assert.match(sqlMode, /arcode:database-connections-changed/);
});

test("the Arcode shell routes every .sql file to a SQL editor", () => {
  const shell = read("../ui/arcode/main.js");

  // A Snowflake name still claims its file; every other `.sql` is SQL Server,
  // so no query lands in the plain editor where Run cannot reach an engine.
  assert.match(shell, /function isSqlServerSqlPath\(pathLike\)/);
  assert.match(shell, /return getPathExtension\(pathLike\) === "\.sql" && !isSnowflakeSqlPath\(pathLike\);/);
  assert.match(shell, /if \(isSnowflakeSqlPath\(filePath\)\) return "snowflake";\s*\n\s*if \(isSqlServerSqlPath\(filePath\)\) return "sqlserver";/);

  // Both SQL tab types share one frame builder and one open-path message.
  assert.match(shell, /function isSqlConsoleTabType\(tabType\)/);
  assert.match(shell, /tab\.type === "sqlserver" \? "sql-server-console" : "snowflake-console"/);
  assert.match(shell, /type: "arcode:sql-console-open-path"/);
  assert.doesNotMatch(shell, /arcode:snowflake-open-path/);

  const framework = read("../ui/arcode/shared/editor_framework.js");
  assert.match(framework, /msg\.type === "arcode:scripting-open-path" \|\| msg\.type === "arcode:sql-console-open-path"/);
});

test("SQL editor tabs sit beside the workspace explorer", () => {
  const shell = read("../ui/arcode/main.js");
  assert.match(
    shell,
    /const usesExplorerWorkspace = tab\?\.type === "editor" \|\| isSqlConsoleTabType\(tab\?\.type\);/,
  );
});
