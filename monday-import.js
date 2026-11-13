const McfMondayImport = {
  sourceIdentity(sourceUrl) {
    const url = new URL(sourceUrl);
    const entryId = url.searchParams.get("entry_id");
    if (url.protocol !== "https:" || !["expertwindows.ie", "www.expertwindows.ie"].includes(url.hostname)
      || url.pathname !== "/wp-admin/admin.php" || url.searchParams.get("page") !== "wpforms-entries"
      || url.searchParams.get("view") !== "details" || !/^\d+$/.test(entryId || "")) {
      throw new Error("Imports are only available from Expert Windows WPForms entry details.");
    }
    return { origin: url.origin, entryId };
  },

  validateEntry(entry, senderUrl) {
    const source = McfMondayImport.sourceIdentity(entry?.sourceUrl);
    const sender = McfMondayImport.sourceIdentity(senderUrl);
    if (source.origin !== sender.origin || source.entryId !== sender.entryId || entry.entryId !== source.entryId) {
      throw new Error("The entry does not match the page being imported.");
    }
    if (typeof entry.fullName !== "string" || !entry.fullName.trim()) throw new Error("Contact name is required.");
    if (!Array.isArray(entry.fields) || !Array.isArray(entry.attachments)) throw new Error("Invalid entry data.");
    for (const file of entry.attachments) {
      const url = new URL(file.url);
      if (url.origin !== source.origin || !url.pathname.startsWith("/wp-content/uploads/") || url.username || url.password) {
        throw new Error("Pictures must come from this site's uploads folder.");
      }
      if (typeof file.name !== "string" || !file.name) throw new Error("A picture has no filename.");
    }
    return source;
  },

  storageKey(boardId, sourceUrl) {
    const source = McfMondayImport.sourceIdentity(sourceUrl);
    // Treat www and the bare domain as the same WordPress site.
    return `mcfImport:${boardId}:expertwindows.ie:${source.entryId}`;
  },

  getDestination(board, groupTitle) {
    const name = groupTitle.trim().toLowerCase();
    const byId = board.groups.find((group) => group.id === groupTitle.trim());
    const matches = byId ? [byId] : board.groups.filter((group) => group.title.trim().toLowerCase() === name);
    if (matches.length !== 1) throw new Error(`Group "${groupTitle}" was not found uniquely on this board. Set its title or ID in extension settings.`);
    return matches[0];
  },

  buildColumnValues(entry, columns, columnMap, assigneeId = "") {
    const values = {};
    const rawValues = {
      email: entry.email,
      phone: entry.phone,
      eircode: entry.eircode,
      address: entry.address,
      projectDetails: entry.message,
      source: entry.sourceUrl,
      inquiryDate: entry.inquiryDate
    };
    const allowedTypes = {
      email: ["email", "text", "long_text"],
      phone: ["phone", "text", "long_text"],
      eircode: ["text", "long_text"],
      address: ["text", "long_text"],
      projectDetails: ["text", "long_text"],
      source: ["link", "text", "long_text"],
      inquiryDate: ["date"]
    };

    if (columnMap.inquiryDate && entry.submittedAt && !entry.inquiryDate) {
      throw new Error("Could not read the form's submission date. Check the entry date, or unmap Inquiry date in extension settings.");
    }

    for (const [key, raw] of Object.entries(rawValues)) {
      const columnId = columnMap[key];
      if (!columnId || !raw) continue;
      const column = columns.find((item) => item.id === columnId);
      if (!column || !allowedTypes[key].includes(column.type)) {
        throw new Error(`Check the ${key} column mapping in extension settings; it is missing or has an incompatible type.`);
      }
      if (Object.hasOwn(values, columnId)) throw new Error("Two imported fields are mapped to the same column. Check extension settings.");
      const value = String(raw);
      if (column.type === "email") {
        values[columnId] = { email: value, text: value };
      } else if (column.type === "phone") {
        let phone = value.replace(/[^\d+]/g, "").replace(/^00/, "+");
        if (/^0[1-9]/.test(phone)) phone = "+353" + phone.slice(1);
        if (/^353/.test(phone)) phone = "+" + phone;
        const countryShortName = phone.startsWith("+353") ? "IE" : phone.startsWith("+44") ? "GB" : "";
        // Other international numbers remain intact in the full entry update.
        if (countryShortName) values[columnId] = { phone, countryShortName };
      } else if (column.type === "link") {
        values[columnId] = { url: value, text: `WPForms entry ${entry.entryId}` };
      } else if (column.type === "date") {
        const date = new Date(`${value}T00:00:00Z`);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) {
          throw new Error("The form's submission date is invalid. Check the entry before importing.");
        }
        values[columnId] = { date: value };
      } else if (column.type === "long_text") {
        values[columnId] = { text: value.slice(0, 2000) };
      } else {
        values[columnId] = value.slice(0, 2000);
      }
    }
    const userId = String(assigneeId).trim();
    if (userId) {
      if (!/^[1-9]\d*$/.test(userId) || !Number.isSafeInteger(Number(userId))) {
        throw new Error("Assignee user ID must be a positive number. Check extension settings.");
      }
      const column = columns.find((item) => item.id === columnMap.assignee && item.type === "people");
      if (!column) {
        throw new Error("Map the assignee to a People column in extension settings, or clear the assignee user ID.");
      }
      values[column.id] = { personsAndTeams: [{ id: Number(userId), kind: "person" }] };
    }
    return values;
  },

  escapeHtml(value) {
    return String(value || "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]);
  },

  buildUpdateBody(entry) {
    const html = (value) => McfMondayImport.escapeHtml(value).replace(/\n/g, "<br>");
    const parts = [
      `<p><strong>${html(entry.formTitle || "WPForms submission")}</strong></p>`,
      `<p><a href="${html(entry.sourceUrl)}">WPForms entry ${html(entry.entryId)}</a>${entry.submittedAt ? `<br>Submitted: ${html(entry.submittedAt)}` : ""}</p>`
    ];
    for (const field of entry.fields) {
      parts.push(`<p><strong>${html(field.label)}</strong><br>${html(field.value || "(empty)")}</p>`);
    }
    if (entry.attachments.length) {
      parts.push("<p><strong>Original uploads</strong><br>" + entry.attachments.map((file) =>
        `<a href="${html(file.url)}">${html(file.name)}</a>`).join("<br>") + "</p>");
    }
    if (entry.notes) parts.push(`<p><strong>Entry notes</strong><br>${html(entry.notes)}</p>`);
    if (entry.journey) parts.push(`<p><strong>User journey</strong><br>${html(entry.journey)}</p>`);
    return parts.join("\n");
  },

  async run(entry, settings, services) {
    const key = McfMondayImport.storageKey(settings.mondayBoardId, entry.sourceUrl);
    const state = (await services.getState(key)) || { uploadedFiles: {}, complete: false };
    if (state.complete) return { state, failures: [] };
    if (state.pendingStep) {
      const error = new Error("A previous monday request has an unconfirmed result. Check monday before importing again to avoid duplicates.");
      error.state = state;
      throw error;
    }
    const persist = () => services.saveState(key, state);
    // Persist each stage before sending it. A lost response must never cause a blind repeat.
    const step = async (name, operation, applyResult) => {
      state.pendingStep = name;
      await persist();
      try {
        const result = await operation();
        applyResult(result);
      } catch (error) {
        if (!error.uncertain) {
          delete state.pendingStep;
          await persist();
        }
        throw error;
      }
      delete state.pendingStep;
      await persist();
    };

    try {
      const board = await services.fetchBoard(settings.mondayBoardId);
      const columnMap = { ...McfColumnFields.buildAutoMap(board.columns), ...settings.mondayColumnMap };
      const group = state.itemId ? null : McfMondayImport.getDestination(board, settings.mondayGroupTitle);
      const columnValues = state.itemId ? null : McfMondayImport.buildColumnValues(entry, board.columns, columnMap, settings.mondayAssigneeId);
      const fileColumnId = state.fileColumnId ?? columnMap.files ?? "";
      if (fileColumnId && !board.columns.some((column) => column.id === fileColumnId && column.type === "file")) {
        throw new Error("Check the pictures / files column mapping in extension settings.");
      }

      if (!state.itemId) {
        await step("create_item", () => services.createItem(entry.fullName.trim(), group.id, columnValues), (item) => {
          state.itemId = item.id;
          state.itemUrl = item.url || `https://monday.com/boards/${settings.mondayBoardId}/pulses/${item.id}`;
          state.fileColumnId = fileColumnId;
        });
      }
      if (!state.updateId) {
        await step("create_update", () => services.createUpdate(state.itemId, McfMondayImport.buildUpdateBody(entry)), (update) => {
          state.updateId = update.id;
        });
      }

      const failures = [];
      for (const file of entry.attachments) {
        if (state.uploadedFiles[file.url]) continue;
        try {
          // Download first: a download failure cannot have created a monday asset.
          const blob = await services.downloadFile(file);
          await step(`upload:${file.name}`, () => services.uploadFile(file, blob, state.itemId, state.updateId, fileColumnId), (asset) => {
            state.uploadedFiles[file.url] = { id: asset.id, name: file.name };
          });
        } catch (error) {
          failures.push(`${file.name}: ${error.message}`);
          if (state.pendingStep) break;
        }
      }
      state.complete = !failures.length;
      await persist();
      return { state, failures };
    } catch (error) {
      error.state = state;
      throw error;
    }
  }
};
