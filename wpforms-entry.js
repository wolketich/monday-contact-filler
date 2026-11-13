const McfWpformsEntry = {
  cleanText(value) {
    return (value || "").replace(/\u00a0/g, " ").replace(/[ \t]+/g, " ")
      .replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  },

  readText(element) {
    if (!element) return "";
    const copy = element.cloneNode(true);
    copy.querySelectorAll(".wpforms-hide, script, style").forEach((node) => node.remove());
    copy.querySelectorAll("br").forEach((node) => node.replaceWith("\n"));
    copy.querySelectorAll("p, div, li").forEach((node) => node.append("\n"));
    return McfWpformsEntry.cleanText(copy.textContent);
  },

  parseSubmissionDate(value) {
    const text = McfWpformsEntry.cleanText(value);
    const months = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
    let year, month, day;
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
    if (match) {
      [, year, month, day] = match;
    } else if ((match = text.match(/^([a-z]+)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})\b/i))) {
      month = months.indexOf(match[1].slice(0, 3).toLowerCase()) + 1;
      [, , day, year] = match;
    } else if ((match = text.match(/^(\d{1,2})(?:st|nd|rd|th)?[\s-]+([a-z]+)[\s,-]+(\d{4})\b/i))) {
      [, day, , year] = match;
      month = months.indexOf(match[2].slice(0, 3).toLowerCase()) + 1;
    } else if ((match = text.match(/^(\d{1,2})[./-](\d{1,2})[./-](\d{4})(?:$|\s)/))) {
      // Numeric WordPress dates on this Irish site use day/month/year.
      [, day, month, year] = match;
    } else return "";

    year = Number(year);
    month = Number(month);
    day = Number(day);
    const date = new Date(Date.UTC(year, month - 1, day));
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return "";
    // Keep the displayed submission date independent of the browser's timezone.
    return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  },

  parse(document, pageUrl) {
    const page = new URL(pageUrl);
    const entryId = page.searchParams.get("entry_id") || document.querySelector('input[name="entry_id"]')?.value;
    const wrapper = document.querySelector("#wpforms-entry-fields .wpforms-entries-fields-wrapper");
    if (!wrapper || !/^\d+$/.test(entryId || "")) {
      throw new Error("Open a WPForms entry to import its contact details.");
    }

    const attachments = [];
    const seenFiles = new Set();
    const nodes = [...wrapper.querySelectorAll(".wpforms-entry-field-item")];
    const fields = nodes.map((node) => {
      const label = McfWpformsEntry.readText(node.querySelector(".wpforms-entry-field-name"));
      const valueNode = node.querySelector(".wpforms-entry-field-value");
      let value = McfWpformsEntry.readText(valueNode);
      if (node.classList.contains("wpforms-field-file-upload")) {
        const files = [];
        for (const link of valueNode?.querySelectorAll("a[href]") || []) {
          const url = new URL(link.getAttribute("href"), page);
          if (url.origin !== page.origin || !url.pathname.startsWith("/wp-content/uploads/")) {
            throw new Error("A file link is outside this site's uploads folder. Check the entry before importing.");
          }
          let fallbackName = url.pathname.split("/").pop();
          try { fallbackName = decodeURIComponent(fallbackName); } catch { /* Keep the URL filename. */ }
          const name = McfWpformsEntry.readText(link) || fallbackName || "attachment";
          files.push(`${name}: ${url.href}`);
          if (!seenFiles.has(url.href)) {
            seenFiles.add(url.href);
            attachments.push({ url: url.href, name });
          }
        }
        value = files.join("\n");
      }
      return { label, value };
    });

    const findValue = (className, labelPattern) => {
      const index = nodes.findIndex((node) => node.classList.contains(className));
      return (index >= 0 ? fields[index].value : fields.find((field) => labelPattern.test(field.label))?.value) || "";
    };
    const fullName = findValue("wpforms-field-name", /^(full )?name$/i);
    if (!fullName) throw new Error("This entry has no contact name. Add a name before importing.");

    const source = new URL("/wp-admin/admin.php", page.origin);
    source.search = new URLSearchParams({ page: "wpforms-entries", view: "details", entry_id: entryId }).toString();
    const address = fields.filter((field) => /address|eir\s?code|area/i.test(field.label))
      .map((field) => field.value).filter(Boolean).join("\n");
    const eircode = address.match(/\b([AC-FHKNPRTV-Y]\d[0-9W])[\s-]*([0-9AC-FHKNPRTV-Y]{4})\b/i);
    const submittedAt = McfWpformsEntry.readText(document.querySelector(".wpforms-entry-date .date-time"));
    const submittedDateTime = document.querySelector(".wpforms-entry-date [datetime]")?.getAttribute("datetime") || "";
    const journeyRows = [...document.querySelectorAll("#wpforms-entry-user-journey tr")];

    return {
      entryId,
      formId: document.querySelector('input[name="form_id"]')?.value || "",
      formTitle: McfWpformsEntry.readText(document.querySelector("#wpforms-entry-fields h2")),
      fullName,
      email: findValue("wpforms-field-email", /e-?mail/i),
      phone: findValue("wpforms-field-phone", /phone|mobile|telephone/i),
      address,
      eircode: eircode ? `${eircode[1]} ${eircode[2]}`.toUpperCase() : "",
      message: findValue("wpforms-field-textarea", /message|enquiry|project details/i),
      fields,
      attachments,
      sourceUrl: source.href,
      submittedAt,
      inquiryDate: McfWpformsEntry.parseSubmissionDate(submittedAt) || McfWpformsEntry.parseSubmissionDate(submittedDateTime),
      notes: McfWpformsEntry.readText(document.querySelector("#wpforms-entry-notes .wpforms-entry-notes-list")),
      journey: journeyRows.map((row) => [...row.querySelectorAll("td")].map(McfWpformsEntry.readText).filter(Boolean).join(" | ")).join("\n")
    };
  }
};
