(() => {
  const STORAGE_KEY = "mondayContactFillerLead";
  const BUTTON_ID = "monday-contact-filler-button";

  /*
    WhatsApp mode:
    "FULL_DISPLAY_IN_FIRST_NAME" fills:
      First name = Firstname Lastname | Eircode
      Last name = empty

    "SPLIT_FIRST_LAST" fills:
      First name = Firstname
      Last name = Lastname | Eircode
  */
  const WHATSAPP_NAME_MODE = "FULL_DISPLAY_IN_FIRST_NAME";

  const MONDAY_COLUMNS = {
    quoteValue: "numeric_mkxpg30y",
    quoteDate: "date_mky44ttv",
    details: "long_textulr8cj0f",
    status: "status",
    email: "email_mkxpc0aq",
    location: "location_mkxpbfk8",
    eircode: "text_mm20s5jm",
    houseNo: "text_mkzxqr9j",
    phone: "phone_mkxpfxef"
  };

  function cleanText(value) {
    return (value || "")
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+/g, " ")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function isUseful(value) {
    const text = cleanText(value).toLowerCase();
    return text && text !== "na" && text !== "n/a" && text !== "none" && text !== "empty";
  }

  function splitName(fullName) {
    const parts = cleanText(fullName).split(/\s+/).filter(Boolean);
    const firstName = parts.shift() || "";
    const lastName = parts.join(" ");
    return { firstName, lastName };
  }

  function getSelectedMondayRows() {
    return [...document.querySelectorAll(".pulse-component.pulse-checkboxed")];
  }

  function getCell(row, columnId) {
    const cell = row.querySelector(`.col-identifier-${columnId}`);
    if (!cell) return "";

    const text = cleanText(cell.innerText);
    if (text) return text;

    const aria = cleanText(cell.getAttribute("aria-label"));
    if (!aria) return "";

    return aria;
  }

  function getMondayName(row) {
    const checkbox = row.querySelector('input[aria-label^="Select item:"]');

    if (checkbox) {
      return cleanText(
        checkbox.getAttribute("aria-label").replace("Select item:", "")
      );
    }

    const nameCell = row.querySelector(".col-identifier-name");
    return cleanText(nameCell?.innerText || "").split("\n")[0] || "";
  }

  function getMondayEmail(row) {
    const emailLink = row.querySelector(".col-identifier-email_mkxpc0aq a");
    return cleanText(emailLink?.textContent || getCell(row, MONDAY_COLUMNS.email));
  }

  function getMondayPhone(row) {
    const phoneText = row.querySelector(".col-identifier-phone_mkxpfxef .phone-cell-number");
    return cleanText(phoneText?.textContent || getCell(row, MONDAY_COLUMNS.phone));
  }

  function getMondayIds(row) {
    const id = row.id || "";
    const match = id.match(/currentBoard-(\d+)-(\d+)-/);

    return {
      boardId: match ? match[1] : "",
      itemId: match ? match[2] : ""
    };
  }

  function getMondayItemLink(row) {
    const { boardId, itemId } = getMondayIds(row);

    if (!boardId || !itemId) return window.location.href;

    return `${window.location.origin}/boards/${boardId}/pulses/${itemId}`;
  }

  function normalizeIrishPhone(phone) {
    let raw = cleanText(phone);
    let digits = raw.replace(/[^\d+]/g, "");

    if (digits.startsWith("+353")) {
      digits = digits.slice(4);
    } else if (digits.startsWith("00353")) {
      digits = digits.slice(5);
    } else if (digits.startsWith("353")) {
      digits = digits.slice(3);
    }

    digits = digits.replace(/\D/g, "");

    if (digits.startsWith("0")) {
      digits = digits.slice(1);
    }

    const area = digits.slice(0, 2);
    const number = digits.slice(2);

    let localFormatted = digits;

    if (digits.length === 9) {
      localFormatted = `${digits.slice(0, 2)} ${digits.slice(2, 5)} ${digits.slice(5)}`;
    }

    return {
      raw,
      countryCode: "+353",
      area,
      number,
      localDigits: digits,
      localFormatted
    };
  }

  function buildAddress({ houseNo, location, eircode }) {
    const parts = [];

    if (isUseful(houseNo)) parts.push(houseNo);
    if (isUseful(location)) parts.push(location);
    if (isUseful(eircode)) parts.push(eircode);

    return parts.join(", ");
  }

  function readMondayLead() {
    const rows = getSelectedMondayRows();

    if (!rows.length) {
      throw new Error("No selected Monday row found.");
    }

    const row = rows[0];

    const fullName = getMondayName(row);
    const { firstName, lastName } = splitName(fullName);

    const email = getMondayEmail(row);
    const phone = getMondayPhone(row);
    const parsedPhone = normalizeIrishPhone(phone);

    const location = getCell(row, MONDAY_COLUMNS.location);
    const eircode = getCell(row, MONDAY_COLUMNS.eircode);
    const houseNo = getCell(row, MONDAY_COLUMNS.houseNo);

    const lead = {
      fullName,
      firstName,
      lastName,
      email,
      phone,
      phoneCountryCode: parsedPhone.countryCode,
      phoneAreaCode: parsedPhone.area,
      phoneNumber: parsedPhone.number,
      whatsappPhone: parsedPhone.localFormatted,
      location,
      eircode,
      houseNo,
      billingAddress: buildAddress({ houseNo, location, eircode }),
      quoteValue: getCell(row, MONDAY_COLUMNS.quoteValue),
      quoteDate: getCell(row, MONDAY_COLUMNS.quoteDate),
      status: getCell(row, MONDAY_COLUMNS.status),
      projectDetails: getCell(row, MONDAY_COLUMNS.details),
      mondayItemLink: getMondayItemLink(row),
      savedAt: new Date().toISOString()
    };

    return lead;
  }

  async function saveMondayLead() {
    try {
      const lead = readMondayLead();

      await chrome.storage.local.set({
        [STORAGE_KEY]: lead
      });

      const summary = [
        `Name: ${lead.fullName}`,
        `Email: ${lead.email}`,
        `Phone: ${lead.phone}`,
        `Address: ${lead.billingAddress}`,
        `Monday: ${lead.mondayItemLink}`
      ].join("\n");

      await navigator.clipboard.writeText(summary);

      showToast(`Saved: ${lead.fullName}`);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not save Monday item.");
    }
  }

  async function getSavedLead() {
    const result = await chrome.storage.local.get(STORAGE_KEY);
    const lead = result[STORAGE_KEY];

    if (!lead) {
      throw new Error("No saved Monday item found. Save one from Monday first.");
    }

    return lead;
  }

  function setNativeInput(input, value) {
    if (!input) return false;

    input.focus();

    const prototype = Object.getPrototypeOf(input);
    const descriptor = Object.getOwnPropertyDescriptor(prototype, "value");

    if (descriptor && descriptor.set) {
      descriptor.set.call(input, value);
    } else {
      input.value = value;
    }

    input.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));

    input.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
  }

  function setContentEditable(element, value) {
    if (!element) return false;

    element.focus();

    document.execCommand("selectAll", false, null);
    document.execCommand("insertText", false, value);

    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));

    element.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
  }

  function getWhatsAppNameValues(lead) {
    const eircodePart = isUseful(lead.eircode) ? ` | ${lead.eircode}` : "";

    if (WHATSAPP_NAME_MODE === "SPLIT_FIRST_LAST") {
      return {
        first: lead.firstName,
        last: `${lead.lastName}${eircodePart}`.trim()
      };
    }

    return {
      first: `${lead.fullName}${eircodePart}`.trim(),
      last: ""
    };
  }

  async function fillWhatsAppContact() {
    try {
      const lead = await getSavedLead();

      const firstInput = document.querySelector('[aria-label="First name"][contenteditable="true"]');
      const lastInput = document.querySelector('[aria-label="Last name"][contenteditable="true"]');
      const phoneInput = document.querySelector('input[data-testid="phone-number-input"], input[aria-label="Phone number"]');

      const whatsappNames = getWhatsAppNameValues(lead);

      const filledFirst = setContentEditable(firstInput, whatsappNames.first);
      const filledLast = setContentEditable(lastInput, whatsappNames.last);
      const filledPhone = setNativeInput(phoneInput, lead.whatsappPhone || lead.phoneNumber || "");

      if (!filledFirst && !filledLast && !filledPhone) {
        throw new Error("WhatsApp contact form fields not found.");
      }

      showToast(`Filled WhatsApp: ${lead.fullName}`);
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not fill WhatsApp.");
    }
  }

  function queryXero(selector) {
    return document.querySelector(selector);
  }

  async function fillXeroContact() {
    try {
      const lead = await getSavedLead();

      const contactNameInput = queryXero('#contactName, input[data-automationid="CONTACT_NAME--input"]');
      const firstNameInput = queryXero('#first-name, input[data-automationid="PERSON_FIRST_NAME--input"]');
      const lastNameInput = queryXero('#last-name, input[data-automationid="PERSON_LAST_NAME--input"]');
      const emailInput = queryXero('input[data-automationid="PERSON_EMAIL--input"]');

      const phoneCountryInput = queryXero('input[data-automationid="PHONE_COUNTRY_CODE--input"]');
      const phoneAreaInput = queryXero('input[data-automationid="PHONE_AREA_CODE--input"]');
      const phoneNumberInput = queryXero('input[data-automationid="PHONE_NUMBER--input"]');

      const addressInputs = [...document.querySelectorAll('input[data-automationid="ADDRESS_SEARCH_INPUT--input"]')];
      const billingAddressInput = addressInputs[0];

      setNativeInput(contactNameInput, lead.fullName);
      setNativeInput(firstNameInput, lead.firstName);
      setNativeInput(lastNameInput, lead.lastName);
      setNativeInput(emailInput, lead.email);

      setNativeInput(phoneCountryInput, lead.phoneCountryCode || "+353");
      setNativeInput(phoneAreaInput, lead.phoneAreaCode || "");
      setNativeInput(phoneNumberInput, lead.phoneNumber || "");

      if (billingAddressInput && lead.billingAddress) {
        setNativeInput(billingAddressInput, lead.billingAddress);
        billingAddressInput.focus();
      }

      showToast("Filled Xero. Pick the billing address result manually.");
    } catch (error) {
      console.error(error);
      showToast(error.message || "Could not fill Xero.");
    }
  }

  function showToast(message) {
    const oldToast = document.getElementById("monday-contact-filler-toast");
    if (oldToast) oldToast.remove();

    const toast = document.createElement("div");
    toast.id = "monday-contact-filler-toast";
    toast.textContent = message;

    Object.assign(toast.style, {
      position: "fixed",
      right: "24px",
      bottom: "84px",
      zIndex: "999999",
      background: "#111",
      color: "#fff",
      padding: "10px 14px",
      borderRadius: "8px",
      fontSize: "14px",
      fontFamily: "Arial, sans-serif",
      boxShadow: "0 4px 14px rgba(0,0,0,0.25)",
      maxWidth: "360px"
    });

    document.body.appendChild(toast);

    setTimeout(() => toast.remove(), 3000);
  }

  function injectButton(label, handler) {
    if (document.getElementById(BUTTON_ID)) return;

    const button = document.createElement("button");
    button.id = BUTTON_ID;
    button.textContent = label;

    Object.assign(button.style, {
      position: "fixed",
      right: "24px",
      bottom: "24px",
      zIndex: "999999",
      background: "#0073ea",
      color: "#fff",
      border: "none",
      borderRadius: "8px",
      padding: "12px 16px",
      fontSize: "14px",
      fontWeight: "600",
      cursor: "pointer",
      boxShadow: "0 4px 14px rgba(0,0,0,0.25)"
    });

    button.addEventListener("click", handler);
    document.body.appendChild(button);
  }

  function runForCurrentSite() {
    const host = window.location.host;

    if (host.includes("monday.com")) {
      injectButton("Save selected Monday item", saveMondayLead);
      return;
    }

    if (host === "web.whatsapp.com") {
      injectButton("Fill WhatsApp contact", fillWhatsAppContact);
      return;
    }

    if (host.includes("xero.com")) {
      injectButton("Fill Xero contact", fillXeroContact);
    }
  }

  runForCurrentSite();

  const observer = new MutationObserver(() => runForCurrentSite());
  observer.observe(document.body, {
    childList: true,
    subtree: true
  });
})();