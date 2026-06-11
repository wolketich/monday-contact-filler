const SETTINGS_KEYS = ["mondayApiToken", "mondayBoardId", "mondaySubdomain", "mondayColumnMap"];

const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const loadColumnsBtn = document.getElementById("load-columns");
const columnMapSection = document.getElementById("column-map");
const columnFieldsEl = document.getElementById("column-fields");

let boardColumns = [];

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

function getColumnMapFromForm() {
  const map = {};

  for (const field of McfColumnFields.FIELDS) {
    const select = document.getElementById(`column-${field.key}`);
    if (select?.value) {
      map[field.key] = select.value;
    }
  }

  return map;
}

function renderColumnFields(columnMap = {}) {
  columnFieldsEl.innerHTML = "";

  for (const field of McfColumnFields.FIELDS) {
    const row = document.createElement("div");
    row.className = "field-row";

    const label = document.createElement("label");
    label.htmlFor = `column-${field.key}`;
    label.innerHTML = field.required
      ? `${field.label} <span class="required">*</span>`
      : field.label;

    const select = document.createElement("select");
    select.id = `column-${field.key}`;

    const emptyOption = document.createElement("option");
    emptyOption.value = "";
    emptyOption.textContent = "— Not mapped —";
    select.appendChild(emptyOption);

    for (const column of boardColumns) {
      const option = document.createElement("option");
      option.value = column.id;
      option.textContent = `${column.title} (${column.type})`;
      select.appendChild(option);
    }

    if (columnMap[field.key]) {
      select.value = columnMap[field.key];
    }

    row.append(label, select);
    columnFieldsEl.appendChild(row);
  }

  columnMapSection.style.display = boardColumns.length ? "block" : "none";
}

async function loadSettings() {
  const result = await chrome.storage.local.get(SETTINGS_KEYS);

  document.getElementById("mondayApiToken").value = result.mondayApiToken || "";
  document.getElementById("mondayBoardId").value = result.mondayBoardId || "";
  document.getElementById("mondaySubdomain").value = result.mondaySubdomain || "";

  const savedMap = result.mondayColumnMap || {};

  if (Object.keys(savedMap).length) {
    await loadBoardColumns(false);
    renderColumnFields(savedMap);
  }
}

async function loadBoardColumns(showMessages = true) {
  const mondayApiToken = document.getElementById("mondayApiToken").value.trim();
  const mondayBoardId = document.getElementById("mondayBoardId").value.trim();

  if (!mondayApiToken) {
    if (showMessages) setStatus("Enter an API token first.", "error");
    return false;
  }

  if (!mondayBoardId || !/^\d+$/.test(mondayBoardId)) {
    if (showMessages) setStatus("Board ID must be a number.", "error");
    return false;
  }

  if (showMessages) setStatus("Loading board columns…", "");

  const response = await chrome.runtime.sendMessage({
    type: "fetchBoardColumns",
    boardId: mondayBoardId,
    token: mondayApiToken
  });

  if (!response?.ok) {
    if (showMessages) setStatus(response?.error || "Could not load columns.", "error");
    return false;
  }

  boardColumns = response.columns || [];
  const existingMap = getColumnMapFromForm();
  const hasExisting = Object.keys(existingMap).length > 0;
  const columnMap = hasExisting ? existingMap : McfColumnFields.buildAutoMap(boardColumns);

  renderColumnFields(columnMap);

  if (showMessages) {
    setStatus(`Loaded ${boardColumns.length} columns.`, "success");
  }

  return true;
}

loadColumnsBtn.addEventListener("click", () => {
  loadBoardColumns(true);
});

form.addEventListener("submit", async (event) => {
  event.preventDefault();

  const mondayApiToken = document.getElementById("mondayApiToken").value.trim();
  const mondayBoardId = document.getElementById("mondayBoardId").value.trim();
  const mondaySubdomain = document.getElementById("mondaySubdomain").value.trim();
  const mondayColumnMap = getColumnMapFromForm();

  if (!mondayApiToken) {
    setStatus("API token is required.", "error");
    return;
  }

  if (!mondayBoardId || !/^\d+$/.test(mondayBoardId)) {
    setStatus("Board ID must be a number.", "error");
    return;
  }

  for (const field of McfColumnFields.FIELDS) {
    if (field.required && !mondayColumnMap[field.key]) {
      setStatus(`Map the required column: ${field.label}.`, "error");
      return;
    }
  }

  await chrome.storage.local.set({
    mondayApiToken,
    mondayBoardId,
    mondaySubdomain,
    mondayColumnMap
  });

  setStatus("Settings saved.", "success");
});

loadSettings();
