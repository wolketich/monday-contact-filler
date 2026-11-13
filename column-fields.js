const McfColumnFields = {
  FIELDS: [
    { key: "email", label: "Email", required: true },
    { key: "phone", label: "Phone", required: true },
    { key: "eircode", label: "Eircode", required: true },
    { key: "location", label: "Location" },
    { key: "houseNo", label: "House No." },
    { key: "status", label: "Status" },
    { key: "quoteValue", label: "Quote value" },
    { key: "inquiryDate", label: "Inquiry date (submission date)" },
    { key: "quoteDate", label: "Quote date" },
    { key: "projectDetails", label: "Project details / message" },
    { key: "address", label: "Address / area (text)" },
    { key: "files", label: "Pictures / files" },
    { key: "source", label: "WPForms entry link" },
    { key: "assignee", label: "Assigned salesperson (People)" }
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
    if (type === "people") return "assignee";
    if (type === "location") return "location";
    if (type === "status") return "status";
    if (type === "file") return "files";
    if (type === "link" && /source|wpforms|entry/.test(title)) return "source";
    if (title.includes("eircode") || title.includes("eir code")) return "eircode";
    if (title.includes("house")) return "houseNo";
    if (title.includes("quote") && (type === "numbers" || type === "numeric")) return "quoteValue";
    if (type === "date" && /inquir|enquir|submitted|submission/.test(title)) return "inquiryDate";
    if (title.includes("date") && type === "date") return "quoteDate";
    if (["text", "long_text"].includes(type) && /address|area/.test(title)) return "address";
    if (["text", "long_text", "long-text"].includes(type) && /detail|message|enquiry/.test(title)) return "projectDetails";

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
