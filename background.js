importScripts("column-fields.js", "monday-import.js");

const MONDAY_API_URL = "https://api.monday.com/v2";
const MONDAY_API_VERSION = "2026-10";
const importsInFlight = new Map();
let localDefaultsPromise;

chrome.storage.local.setAccessLevel?.({ accessLevel: "TRUSTED_CONTEXTS" });

const SEARCH_QUERY = `
  query SearchBoardItems($boardIds: [ID!], $compareValue: CompareValue!, $columnIds: [String!]) {
    boards(ids: $boardIds) {
      items_page(
        limit: 20
        query_params: {
          rules: [{
            column_id: "name"
            compare_value: $compareValue
            operator: contains_text
          }]
        }
      ) {
        items {
          id
          name
          column_values(ids: $columnIds) {
            id
            text
            value
          }
        }
      }
    }
  }
`;

const BOARD_COLUMNS_QUERY = `
  query BoardColumns($boardIds: [ID!]) {
    boards(ids: $boardIds) {
      id
      groups { id title }
      columns {
        id
        title
        type
      }
    }
  }
`;

async function getMondaySettings() {
  if (!localDefaultsPromise) {
    localDefaultsPromise = fetch(chrome.runtime.getURL("defaults.local.json"))
      .then((response) => response.ok ? response.json() : {})
      .catch(() => ({}));
  }
  const [defaults, saved] = await Promise.all([
    localDefaultsPromise,
    chrome.storage.local.get(["mondayApiToken", "mondayBoardId", "mondayGroupTitle", "mondayAssigneeId", "mondaySubdomain", "mondayColumnMap"])
  ]);
  return Object.fromEntries(Object.entries({
    mondayApiToken: "",
    mondayBoardId: "5102605911",
    mondayGroupTitle: "Quoting in Progress",
    mondayAssigneeId: "74537460",
    mondaySubdomain: "",
    mondayColumnMap: {}
  }).map(([key, fallback]) => [key, saved[key] ?? defaults[key] ?? fallback]));
}

function mondayError(message, uncertain = false) {
  return Object.assign(new Error(message), { uncertain });
}

async function mondayRequest(body, token, { upload = false, mutation = false } = {}) {
  if (!token) throw new Error("Monday API token not configured. Open extension settings.");
  let response;
  try {
    response = await fetch(upload ? `${MONDAY_API_URL}/file` : MONDAY_API_URL, {
      method: "POST",
      headers: {
        ...(!upload ? { "Content-Type": "application/json" } : {}),
        "API-Version": MONDAY_API_VERSION,
        Authorization: token
      },
      body,
      signal: AbortSignal.timeout(25000)
    });
  } catch {
    throw mondayError("Could not reach monday or the request timed out. Check the connection.", mutation);
  }
  if (response.status === 401 || response.status === 403) {
    throw new Error("Monday rejected the API token or its permissions. Check extension settings.");
  }
  let payload;
  try { payload = await response.json(); }
  catch { throw mondayError(`Monday returned an unreadable response (${response.status}).`, mutation); }
  if (!response.ok || payload.errors?.length || payload.error_message || payload.error) {
    const message = payload.errors?.map((error) => error.message).join("; ")
      || payload.error_message || payload.error || `Monday API error (${response.status})`;
    throw mondayError(String(message), mutation && (response.status >= 500 || Boolean(payload.data)));
  }
  return payload.data;
}

async function mondayGraphQL(query, variables, tokenOverride) {
  const token = tokenOverride || (await getMondaySettings()).mondayApiToken;
  return mondayRequest(JSON.stringify({ query, variables }), token, { mutation: /^\s*mutation\b/.test(query) });
}

async function fetchBoard(boardId, tokenOverride) {
  const data = await mondayGraphQL(BOARD_COLUMNS_QUERY, { boardIds: [boardId] }, tokenOverride);
  const board = data?.boards?.[0];
  if (!board) throw new Error("Monday board not found or not accessible. Check the board ID and API token in extension settings.");
  return board;
}

async function searchMondayItems(query) {
  const { mondayBoardId, mondayColumnMap } = await getMondaySettings();

  if (!mondayBoardId) {
    throw new Error("Monday board ID not configured. Open extension settings.");
  }

  const columnIds = McfColumnFields.getConfiguredColumnIds(mondayColumnMap);

  if (!columnIds.length) {
    throw new Error("Monday column mapping not configured. Open extension settings.");
  }

  const data = await mondayGraphQL(SEARCH_QUERY, {
    boardIds: [mondayBoardId],
    compareValue: [query],
    columnIds
  });

  const board = data?.boards?.[0];
  return board?.items_page?.items || [];
}

async function downloadEntryFile(file) {
  let response;
  try {
    response = await fetch(file.url, { credentials: "include", signal: AbortSignal.timeout(25000) });
  } catch { throw new Error("Could not download this file. Check the connection and your WordPress login."); }
  if (!response.ok) throw new Error(`File download failed (${response.status}).`);
  const source = new URL(file.url);
  const finalUrl = new URL(response.url || file.url);
  if (finalUrl.origin !== source.origin || !finalUrl.pathname.startsWith("/wp-content/uploads/")) {
    throw new Error("File redirected away from the uploads folder. Check your WordPress login.");
  }
  if (/text\/html|application\/json/i.test(response.headers.get("Content-Type") || "")) {
    throw new Error("The site returned a page instead of a file. Check your WordPress login.");
  }
  const maxBytes = 500 * 1024 * 1024;
  if (Number(response.headers.get("Content-Length")) > maxBytes) throw new Error("This file exceeds monday's 500 MB upload limit.");
  const blob = await response.blob();
  if (!blob.size) throw new Error("The downloaded file is empty.");
  if (blob.size > maxBytes) throw new Error("This file exceeds monday's 500 MB upload limit.");
  return blob;
}

function requireResult(data, key) {
  if (!data?.[key]?.id) throw mondayError("Monday did not return a confirmation. Check monday before retrying.", true);
  return data[key];
}

async function importWpformsEntry(entry, senderUrl) {
  McfMondayImport.validateEntry(entry, senderUrl);
  const settings = await getMondaySettings();
  if (!/^\d+$/.test(settings.mondayBoardId)) throw new Error("Set a numeric board ID in extension settings.");
  const key = McfMondayImport.storageKey(settings.mondayBoardId, entry.sourceUrl);
  if (importsInFlight.has(key)) return importsInFlight.get(key);
  const token = settings.mondayApiToken;
  const run = McfMondayImport.run(entry, settings, {
    getState: async (storageKey) => (await chrome.storage.local.get(storageKey))[storageKey],
    saveState: (storageKey, state) => chrome.storage.local.set({ [storageKey]: state }),
    fetchBoard: (boardId) => fetchBoard(boardId, token),
    createItem: async (name, groupId, values) => requireResult(await mondayGraphQL(`
      mutation ImportContact($boardId: ID!, $groupId: String!, $name: String!, $values: JSON!) {
        create_item(board_id: $boardId, group_id: $groupId, item_name: $name, column_values: $values) { id url }
      }`, { boardId: settings.mondayBoardId, groupId, name, values: JSON.stringify(values) }, token), "create_item"),
    createUpdate: async (itemId, body) => requireResult(await mondayGraphQL(`
      mutation ImportEntryDetails($itemId: ID!, $body: String!) {
        create_update(item_id: $itemId, body: $body) { id }
      }`, { itemId, body }, token), "create_update"),
    downloadFile: downloadEntryFile,
    uploadFile: async (file, blob, itemId, updateId, fileColumnId) => {
      const mutation = fileColumnId ? "add_file_to_column" : "add_file_to_update";
      const args = fileColumnId
        ? `item_id: ${itemId}, column_id: ${JSON.stringify(fileColumnId)}`
        : `update_id: ${updateId}`;
      const form = new FormData();
      form.append("query", `mutation ($file: File!) { ${mutation}(${args}, file: $file) { id } }`);
      form.append("map", JSON.stringify({ upload: "variables.file" }));
      form.append("upload", blob, file.name.replace(/[\/\\\x00-\x1f]/g, "_"));
      return requireResult(await mondayRequest(form, token, { upload: true, mutation: true }), mutation);
    }
  }).finally(() => importsInFlight.delete(key));
  importsInFlight.set(key, run);
  return run;
}

async function getImportStatus(sourceUrl, senderUrl) {
  const source = McfMondayImport.sourceIdentity(sourceUrl);
  const sender = McfMondayImport.sourceIdentity(senderUrl);
  if (source.origin !== sender.origin || source.entryId !== sender.entryId) throw new Error("Entry page mismatch.");
  const settings = await getMondaySettings();
  const key = McfMondayImport.storageKey(settings.mondayBoardId, sourceUrl);
  return (await chrome.storage.local.get(key))[key] || null;
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === "openOptionsPage") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "fetchBoardColumns") {
    if (sender.url !== chrome.runtime.getURL("options.html")) {
      sendResponse({ ok: false, error: "Open extension settings to load board columns." });
      return false;
    }
    fetchBoard(message.boardId, message.token)
      .then((board) => sendResponse({ ok: true, columns: board.columns, groups: board.groups }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "searchMondayItems") {
    searchMondayItems(message.query)
      .then((items) => sendResponse({ ok: true, items }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "getMondaySettings") {
    getMondaySettings()
      .then((settings) => {
        const { mondayApiToken, ...publicSettings } = settings;
        sendResponse({ ok: true, settings: sender.url === chrome.runtime.getURL("options.html")
          ? settings : { ...publicSettings, mondayApiTokenConfigured: Boolean(mondayApiToken) } });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  if (message.type === "importWpformsEntry") {
    importWpformsEntry(message.entry, sender.url)
      .then((result) => sendResponse({ ok: true, ...result }))
      .catch((error) => sendResponse({ ok: false, error: error.message, state: error.state }));
    return true;
  }

  if (message.type === "getWpformsImportStatus") {
    getImportStatus(message.sourceUrl, sender.url)
      .then((state) => sendResponse({ ok: true, state }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
