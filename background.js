const MONDAY_API_URL = "https://api.monday.com/v2";

const MONDAY_COLUMN_IDS = [
  "numeric_mkxpg30y",
  "date_mky44ttv",
  "long_textulr8cj0f",
  "status",
  "email_mkxpc0aq",
  "location_mkxpbfk8",
  "text_mm20s5jm",
  "text_mkzxqr9j",
  "phone_mkxpfxef"
];

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

async function getMondaySettings() {
  const result = await chrome.storage.local.get([
    "mondayApiToken",
    "mondayBoardId",
    "mondaySubdomain"
  ]);

  return {
    mondayApiToken: result.mondayApiToken || "",
    mondayBoardId: result.mondayBoardId || "",
    mondaySubdomain: result.mondaySubdomain || ""
  };
}

async function mondayGraphQL(query, variables) {
  const { mondayApiToken } = await getMondaySettings();

  if (!mondayApiToken) {
    throw new Error("Monday API token not configured. Open extension settings.");
  }

  const response = await fetch(MONDAY_API_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: mondayApiToken
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

async function searchMondayItems(query) {
  const { mondayBoardId } = await getMondaySettings();

  if (!mondayBoardId) {
    throw new Error("Monday board ID not configured. Open extension settings.");
  }

  const data = await mondayGraphQL(SEARCH_QUERY, {
    boardIds: [mondayBoardId],
    compareValue: [query],
    columnIds: MONDAY_COLUMN_IDS
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
