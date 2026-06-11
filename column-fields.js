const McfColumnFields = {
  FIELDS: [
    { key: "email", label: "Email", required: true },
    { key: "phone", label: "Phone", required: true },
    { key: "eircode", label: "Eircode", required: true },
    { key: "location", label: "Location" },
    { key: "houseNo", label: "House No." },
    { key: "status", label: "Status" },
    { key: "quoteValue", label: "Quote value" },
    { key: "quoteDate", label: "Quote date" },
    { key: "projectDetails", label: "Project details" }
  ],

  getColumnId(columnMap, key) {
    return columnMap?.[key] || "";
  },

  getConfiguredColumnIds(columnMap) {
    if (!columnMap) return [];

    const ids = McfColumnFields.FIELDS
      .map((field) => columnMap[field.key])
      .filter(Boolean);

    return [...new Set(ids)];
  },

  guessFieldForColumn(column) {
    const title = (column.title || "").toLowerCase();
    const type = (column.type || "").toLowerCase();

    if (type === "email") return "email";
    if (type === "phone") return "phone";
    if (type === "location") return "location";
    if (type === "status") return "status";
    if (title.includes("eircode") || title.includes("eir code")) return "eircode";
    if (title.includes("house")) return "houseNo";
    if (title.includes("quote") && (type === "numbers" || type === "numeric")) return "quoteValue";
    if (title.includes("date") && type === "date") return "quoteDate";
    if ((type === "long_text" || type === "long-text") && title.includes("detail")) return "projectDetails";

    return null;
  },

  buildAutoMap(columns) {
    const map = {};

    for (const column of columns) {
      const fieldKey = McfColumnFields.guessFieldForColumn(column);
      if (fieldKey && !map[fieldKey]) {
        map[fieldKey] = column.id;
      }
    }

    return map;
  }
};
