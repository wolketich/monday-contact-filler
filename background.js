importScripts("column-fields.js");

const MONDAY_API_URL = "https://api.monday.com/v2";

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
      columns {
        id
        title
        type
      }
    }
  }
`;

async function getMondaySettings() {
  const result = await chrome.storage.local.get([
    "mondayApiToken",
    "mondayBoardId",
    "mondaySubdomain",
    "mondayColumnMap"
  ]);

  return {
    mondayApiToken: result.mondayApiToken || "",
    mondayBoardId: result.mondayBoardId || "",
    mondaySubdomain: result.mondaySubdomain || "",
    mondayColumnMap: result.mondayColumnMap || {}
  };
}

async function mondayGraphQL(query, variables, tokenOverride) {
  const { mondayApiToken } = await getMondaySettings();
  const token = tokenOverride || mondayApiToken;

  if (!token) {
    throw new Error("Monday API token not configured. Open extension settings.");
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: token
    },
    body: JSON.stringify({ query, variables })
  });

  if (response.status === 401) {
    throw new Error("Invalid Monday API token.");
  }

  const payload = await response.json();

  if (!response.ok) {
    throw new Error(payload.error || `Monday API error (${response.status})`);
  }

  if (payload.errors?.length) {
    throw new Error(payload.errors.map((error) => error.message).join("; "));
  }

  return payload.data;
}

async function fetchBoardColumns(boardId, tokenOverride) {
  const data = await mondayGraphQL(BOARD_COLUMNS_QUERY, {
    boardIds: [boardId]
  }, tokenOverride);

  return data?.boards?.[0]?.columns || [];
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

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "openOptionsPage") {
    chrome.runtime.openOptionsPage();
    sendResponse({ ok: true });
    return true;
  }

  if (message.type === "fetchBoardColumns") {
    fetchBoardColumns(message.boardId, message.token)
      .then((columns) => sendResponse({ ok: true, columns }))
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
      .then((settings) => sendResponse({ ok: true, settings }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));

    return true;
  }

  return false;
});
