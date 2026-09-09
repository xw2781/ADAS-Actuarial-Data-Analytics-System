// Shared access to the server macro library for both macro windows. It owns the
// library listing request, the overwrite confirmation, and the event that tells
// the rest of the shell that the local macros folder changed, so the Macros
// panel and the Macro Library window cannot drift apart on any of the three.
const API_BASE = window.location.origin;

export const LIBRARY_STATUS_UPDATE_AVAILABLE = "update_available";

export async function fetchLibraryMacros() {
  const response = await fetch(`${API_BASE}/scripting/macro-library`);
  const result = await response.json();
  return {
    available: !!result?.available,
    message: String(result?.message || ""),
    macros: Array.isArray(result?.macros) ? result.macros : [],
  };
}

// Copies one library macro into the local macros folder. A local copy that
// differs is only replaced once the user has confirmed it; that answer comes
// back as `cancelled` rather than as a failure.
export async function copyLibraryMacroToLocal(macroId) {
  const install = async (overwrite) => {
    const response = await fetch(`${API_BASE}/scripting/macro-library/install`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ macro_id: macroId, overwrite }),
    });
    return response.json();
  };
  let result = await install(false);
  if (!result?.success && result?.needs_confirmation) {
    const confirmed = window.confirm(
      `${result.message || "A different local copy of this macro already exists."}\n\n`
      + "Replace your local copy with the library version?",
    );
    if (!confirmed) return { success: false, cancelled: true, message: "" };
    result = await install(true);
  }
  if (!result?.success) throw new Error(result?.message || "Library macro load failed.");
  window.dispatchEvent(new CustomEvent("arcrho:local-macros-changed"));
  return result;
}

// Replaces every local macro the library holds a strictly newer version of,
// without asking: a shared macro is kept at its latest published version. A
// local copy edited at the same or a higher version is not a library update
// and stays as it is. Returns the replaced copies; the same event as a load
// tells both windows when there were any.
export async function syncLibraryMacros() {
  const response = await fetch(`${API_BASE}/scripting/macro-library/sync`, { method: "POST" });
  const result = await response.json();
  const updated = Array.isArray(result?.updated) ? result.updated : [];
  if (updated.length) window.dispatchEvent(new CustomEvent("arcrho:local-macros-changed"));
  return updated;
}
