const SETTINGS_KEYS = ["mondayApiToken", "mondayBoardId", "mondaySubdomain"];

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

async function loadSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEYS);

  document.getElementById("mondayApiToken").value = result.mondayApiToken || "";
  document.getElementById("mondayBoardId").value = result.mondayBoardId || "";
  document.getElementById("mondaySubdomain").value = result.mondaySubdomain || "";
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const mondayApiToken = document.getElementById("mondayApiToken").value.trim();
  const mondayBoardId = document.getElementById("mondayBoardId").value.trim();
  const mondaySubdomain = document.getElementById("mondaySubdomain").value.trim();

  if (!mondayApiToken) {
    setStatus("API token is required.", "error");
    return;
  }

  if (!mondayBoardId || !/^\d+$/.test(mondayBoardId)) {
    setStatus("Board ID must be a number.", "error");
    return;
  }

  await chrome.storage.local.set({
    mondayApiToken,
    mondayBoardId,
    mondaySubdomain
  });

  setStatus("Settings saved.", "success");
});

loadSettings();
