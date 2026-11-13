const form = document.getElementById("settings-form");
const statusEl = document.getElementById("status");
const loadColumnsBtn = document.getElementById("load-columns");
const columnMapSection = document.getElementById("column-map");
const columnFieldsEl = document.getElementById("column-fields");
const boardIdInput = document.getElementById("mondayBoardId");
const tokenInput = document.getElementById("mondayApiToken");
let boardColumns = [];
let mappedBoardId = "";
let savedBoardId = "";
let savedColumnMap = {};

function setStatus(message, type = "") {
  statusEl.textContent = message;
  statusEl.className = type;
}

function getColumnMapFromForm() {
  const boardId = boardIdInput.value.trim();
  if (mappedBoardId !== boardId) return boardId === savedBoardId ? savedColumnMap : {};
  return Object.fromEntries(McfColumnFields.FIELDS.map((field) => [field.key, document.getElementById(`column-${field.key}`)?.value || ""]));
}

function renderColumnFields(columnMap = {}) {
  columnFieldsEl.replaceChildren();
  for (const field of McfColumnFields.FIELDS) {
    const row = document.createElement("div");
    row.className = "field-row";
    const label = document.createElement("label");
    label.htmlFor = `column-${field.key}`;
    label.textContent = field.label;
    const select = document.createElement("select");
    select.id = `column-${field.key}`;
    select.appendChild(new Option("— Not mapped —", ""));
    for (const column of boardColumns) {
      select.appendChild(new Option(`${column.title} (${column.type})`, column.id));
    }
    if (columnMap[field.key]) {
      if (!boardColumns.some((column) => column.id === columnMap[field.key])) {
        select.appendChild(new Option(`${columnMap[field.key]} (unavailable — remap)`, columnMap[field.key]));
      }
      select.value = columnMap[field.key];
    }
    row.append(label, select);
    columnFieldsEl.appendChild(row);
  }
  columnMapSection.style.display = boardColumns.length ? "block" : "none";
}

async function loadBoardColumns(showMessages = true) {
  const token = tokenInput.value.trim();
  const boardId = boardIdInput.value.trim();
  if (!token || !/^\d+$/.test(boardId)) {
    if (showMessages) setStatus("Enter an API token and a numeric board ID first.", "error");
    return;
  }
  const existingMap = getColumnMapFromForm();
  loadColumnsBtn.disabled = true;
  if (showMessages) setStatus("Loading board columns and groups…");
  try {
    const response = await chrome.runtime.sendMessage({ type: "fetchBoardColumns", boardId, token });
    if (!response?.ok) throw new Error(response?.error || "Could not load board columns.");
    if (boardIdInput.value.trim() !== boardId || tokenInput.value.trim() !== token) return;
    boardColumns = response.columns || [];
    mappedBoardId = boardId;
    renderColumnFields({ ...McfColumnFields.buildAutoMap(boardColumns), ...existingMap });
    const groups = document.getElementById("board-groups");
    groups.replaceChildren();
    for (const group of response.groups || []) groups.appendChild(new Option(group.id, group.title));
    if (showMessages) setStatus(`Loaded ${boardColumns.length} columns and ${response.groups?.length || 0} groups.`, "success");
  } catch (error) {
    if (showMessages) setStatus(error.message || "Could not load columns.", "error");
  } finally {
    loadColumnsBtn.disabled = false;
  }
}

async function loadSettings() {
  try {
    const response = await chrome.runtime.sendMessage({ type: "getMondaySettings" });
    if (!response?.ok) throw new Error(response?.error || "Could not load settings.");
    const settings = response.settings;
    for (const key of ["mondayApiToken", "mondayBoardId", "mondayGroupTitle", "mondayAssigneeId", "mondaySubdomain"]) {
      document.getElementById(key).value = settings[key] || "";
    }
    savedBoardId = settings.mondayBoardId;
    savedColumnMap = settings.mondayColumnMap || {};
    await loadBoardColumns(false);
  } catch (error) {
    setStatus(error.message || "Could not load settings.", "error");
  }
}

boardIdInput.addEventListener("input", () => {
  columnMapSection.style.display = boardIdInput.value.trim() === mappedBoardId ? "block" : "none";
});
loadColumnsBtn.addEventListener("click", () => loadBoardColumns());

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  const mondayApiToken = tokenInput.value.trim();
  const mondayBoardId = boardIdInput.value.trim();
  const mondayGroupTitle = document.getElementById("mondayGroupTitle").value.trim();
  const mondayAssigneeId = document.getElementById("mondayAssigneeId").value.trim();
  const mondaySubdomain = document.getElementById("mondaySubdomain").value.trim();
  if (!mondayApiToken) return setStatus("API token is required.", "error");
  if (!/^\d+$/.test(mondayBoardId)) return setStatus("Board ID must be a number.", "error");
  if (!mondayGroupTitle) return setStatus("Enter a group title or ID for imports.", "error");
  if (mondayAssigneeId && (!/^[1-9]\d*$/.test(mondayAssigneeId) || !Number.isSafeInteger(Number(mondayAssigneeId)))) {
    return setStatus("Assignee user ID must be a positive number, or leave it blank.", "error");
  }
  const mondayColumnMap = getColumnMapFromForm();
  try {
    await chrome.storage.local.set({ mondayApiToken, mondayBoardId, mondayGroupTitle, mondayAssigneeId, mondaySubdomain, mondayColumnMap });
    savedBoardId = mondayBoardId;
    savedColumnMap = mondayColumnMap;
    setStatus("Settings saved.", "success");
  } catch (error) {
    setStatus(error.message || "Could not save settings.", "error");
  }
});

loadSettings();
