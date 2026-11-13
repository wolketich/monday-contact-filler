(() => {
  const page = new URL(window.location.href);
  if (page.searchParams.get("page") !== "wpforms-entries" || page.searchParams.get("view") !== "details") return;

  function injectImportAction() {
    const actions = document.querySelector("#wpforms-entry-actions .wpforms-entry-actions-meta");
    if (!actions || document.getElementById("mcf-monday-import")) return;

    const container = document.createElement("div");
    container.id = "mcf-monday-import";
    const button = document.createElement("button");
    button.type = "button";
    button.className = "button button-secondary";
    button.textContent = "Import to monday";
    const status = document.createElement("p");
    status.className = "mcf-import-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    status.textContent = "Includes form details and uploaded pictures.";
    const itemLink = document.createElement("a");
    itemLink.textContent = "View in monday ↗";
    itemLink.target = "_blank";
    itemLink.rel = "noopener noreferrer";
    itemLink.hidden = true;
    const settings = document.createElement("button");
    settings.type = "button";
    settings.className = "button-link mcf-import-settings";
    settings.textContent = "Import settings";
    settings.addEventListener("click", async () => {
      try { await chrome.runtime.sendMessage({ type: "openOptionsPage" }); }
      catch { status.textContent = "Reload this page after reloading the extension, then open its settings."; }
    });
    container.append(button, status, itemLink, settings);
    actions.prepend(container);
    let importStarted = false;

    function renderState(state) {
      itemLink.hidden = !state?.itemUrl;
      if (state?.itemUrl) itemLink.href = state.itemUrl;
      if (state?.complete) {
        button.disabled = true;
        button.textContent = "Imported to monday";
        status.textContent = `Contact, form details and ${Object.keys(state.uploadedFiles || {}).length} file(s) imported.`;
      } else if (state?.pendingStep) {
        button.disabled = true;
        status.textContent = "An earlier request has an unconfirmed result. Check monday before importing again.";
      } else if (state?.itemId) {
        button.textContent = "Retry remaining import";
        status.textContent = "Contact already saved. Retry to finish importing its details or pictures.";
      }
    }

    button.addEventListener("click", async () => {
      button.disabled = true;
      importStarted = true;
      container.setAttribute("aria-busy", "true");
      status.classList.remove("mcf-import-error");
      status.textContent = "Importing contact and pictures…";
      let state;
      try {
        const entry = McfWpformsEntry.parse(document, window.location.href);
        const response = await chrome.runtime.sendMessage({ type: "importWpformsEntry", entry });
        state = response?.state;
        renderState(state);
        if (!response?.ok) throw new Error(response?.error || "Import failed. Check extension settings and try again.");
        if (!state?.complete) {
          status.textContent = `Contact saved. ${response.failures?.join(" ") || "Some details still need importing."}${state?.pendingStep ? " Check monday before importing again; the last upload is unconfirmed." : ""}`;
        }
      } catch (error) {
        status.textContent = error.message || "Import failed. Reload the page and try again.";
        status.classList.add("mcf-import-error");
      } finally {
        button.disabled = Boolean(state?.complete || state?.pendingStep);
        container.removeAttribute("aria-busy");
      }
    });

    chrome.runtime.sendMessage({ type: "getWpformsImportStatus", sourceUrl: page.href })
      .then((response) => {
        if (response?.ok && !importStarted) renderState(response.state);
      })
      .catch(() => { status.textContent = "Reload this page after reloading the extension."; });
  }

  injectImportAction();
  const observer = new MutationObserver(injectImportAction);
  observer.observe(document.body, { childList: true, subtree: true });
  window.addEventListener("pagehide", () => observer.disconnect(), { once: true });
})();
