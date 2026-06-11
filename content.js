(() => {
  const STORAGE_KEY = "mondayContactFillerLead";

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

  function readMondayLeadFromRow(row) {
    const fullName = getMondayName(row);
    const { firstName, lastName } = splitName(fullName);

    const email = getMondayEmail(row);
    const phone = getMondayPhone(row);
    const parsedPhone = normalizeIrishPhone(phone);

    const location = getCell(row, MONDAY_COLUMNS.location);
    const eircode = getCell(row, MONDAY_COLUMNS.eircode);
    const houseNo = getCell(row, MONDAY_COLUMNS.houseNo);

    return {
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
  }

  async function saveMondayLeadFromRow(row) {
    try {
      const lead = readMondayLeadFromRow(row);

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

  function clearContentEditable(element) {
    element.focus();

    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);

    document.execCommand("selectAll", false, null);
    document.execCommand("delete", false, null);
    element.innerHTML = "";
    element.textContent = "";

    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward"
    }));
  }

  function setContentEditable(element, value) {
    if (!element) return false;

    clearContentEditable(element);

    if (value) {
      element.focus();
      document.execCommand("insertText", false, value);

      if (!element.textContent) {
        element.textContent = value;
      }
    }

    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "insertText",
      data: value
    }));

    element.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
  }

  function formatNameWithEircode(fullName, eircode) {
    const name = cleanText(fullName);
    if (!isUseful(eircode)) return name;

    const suffix = ` | ${cleanText(eircode)}`;
    if (name.endsWith(suffix) || name.includes(suffix)) return name;

    return `${name}${suffix}`;
  }

  function getWhatsAppNameValues(lead) {
    if (WHATSAPP_NAME_MODE === "SPLIT_FIRST_LAST") {
      return {
        first: lead.firstName,
        last: formatNameWithEircode(lead.lastName, lead.eircode)
      };
    }

    return {
      first: formatNameWithEircode(lead.fullName, lead.eircode),
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
      top: "24px",
      left: "50%",
      transform: "translateX(-50%)",
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

  function createCopyIconSvg(size) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("viewBox", "0 0 20 20");
    svg.setAttribute("width", String(size));
    svg.setAttribute("height", String(size));
    svg.setAttribute("fill", "currentColor");
    svg.setAttribute("aria-hidden", "true");

    const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
    path.setAttribute(
      "d",
      "M7 4.75C7 3.7835 7.7835 3 8.75 3H14.25C15.2165 3 16 3.7835 16 4.75V10.25C16 11.2165 15.2165 12 14.25 12H13V14.25C13 15.2165 12.2165 16 11.25 16H5.75C4.7835 16 4 15.2165 4 14.25V8.75C4 7.7835 4.7835 7 5.75 7H7V4.75ZM8.75 4.5C8.61193 4.5 8.5 4.61193 8.5 4.75V7.25H11.25C12.2165 7.25 13 8.0335 13 9V11.5H14.25C14.3881 11.5 14.5 11.3881 14.5 11.25V4.75C14.5 4.61193 14.3881 4.5 14.25 4.5H8.75ZM5.75 8.5C5.61193 8.5 5.5 8.61193 5.5 8.75V14.25C5.5 14.3881 5.61193 14.5 5.75 14.5H11.25C11.3881 14.5 11.5 14.3881 11.5 14.25V9H8.75C7.7835 9 7 8.2165 7 7.25V4.75H8.75Z"
    );
    path.setAttribute("fill-rule", "evenodd");
    path.setAttribute("clip-rule", "evenodd");
    svg.appendChild(path);

    return svg;
  }

  function createMondayRowButton() {
    const button = document.createElement("button");
    button.type = "button";
    button.setAttribute("aria-label", "Save contact from Monday");

    Object.assign(button.style, {
      display: "inline-flex",
      alignItems: "center",
      justifyContent: "center",
      width: "24px",
      height: "24px",
      padding: "0",
      marginLeft: "4px",
      border: "none",
      borderRadius: "4px",
      background: "transparent",
      color: "#676879",
      cursor: "pointer",
      flexShrink: "0",
      verticalAlign: "middle"
    });

    button.appendChild(createCopyIconSvg(16));

    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(0, 0, 0, 0.05)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });

    return button;
  }

  function isMondayItemRow(row) {
    if (!row.classList.contains("pulse-component")) return false;
    return !(row.id || "").includes("placeholder");
  }

  function getMondayItemRows() {
    const rows = [...document.querySelectorAll(".pulse-component")].filter(isMondayItemRow);

    if (rows.length) return rows;

    return [...document.querySelectorAll('[data-testid^="item-"] .pulse-component')].filter(isMondayItemRow);
  }

  function isMondayBoardReady() {
    const rows = getMondayItemRows();
    if (!rows.length) return false;

    return rows.some((row) => !!findMondayButtonAnchor(row));
  }

  function findMondayButtonAnchor(row) {
    return (
      row.querySelector('[class*="actionsContainer"]')
      || row.querySelector(".name-cell-component__checkbox-indicator-wrapper")
      || row.querySelector('[class*="nameCellContentContainer"]')
      || row.querySelector('[id^="name-cell-"]')?.closest('[class*="nameCellContentContainer"]')
      || row.querySelector(".col-identifier-name .name-cell-component")
    );
  }

  function injectMondayRowButtons() {
    if (!isMondayBoardReady()) return;

    for (const row of getMondayItemRows()) {
      if (row.dataset.mcfRowButton) continue;

      const anchor = findMondayButtonAnchor(row);
      if (!anchor) continue;

      row.dataset.mcfRowButton = "1";

      const button = createMondayRowButton();
      button.addEventListener("click", (event) => {
        event.stopPropagation();
        event.preventDefault();
        saveMondayLeadFromRow(row);
      });

      anchor.appendChild(button);
    }
  }

  function waitForMondayBoardReady(timeoutMs = 60000) {
    return new Promise((resolve) => {
      if (isMondayBoardReady()) {
        resolve(true);
        return;
      }

      const startedAt = Date.now();

      const poll = () => {
        if (isMondayBoardReady()) {
          resolve(true);
          return;
        }

        if (Date.now() - startedAt >= timeoutMs) {
          resolve(false);
          return;
        }

        setTimeout(poll, 500);
      };

      poll();
    });
  }

  function isWhatsAppContactFormOpen() {
    return !!document.querySelector('[aria-label="First name"][contenteditable="true"]');
  }

  function createWhatsAppFillButton() {
    const button = document.createElement("div");
    button.setAttribute("role", "button");
    button.setAttribute("tabindex", "0");
    button.setAttribute("data-mcf-whatsapp-fill", "1");
    button.setAttribute("aria-label", "Fill from Monday");

    Object.assign(button.style, {
      display: "flex",
      alignItems: "center",
      justifyContent: "center",
      width: "40px",
      height: "40px",
      cursor: "pointer",
      borderRadius: "50%",
      color: "#00a884",
      background: "transparent",
      boxShadow: "none"
    });

    button.appendChild(createCopyIconSvg(24));

    button.addEventListener("mouseenter", () => {
      button.style.background = "rgba(0, 0, 0, 0.06)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "transparent";
    });

    button.addEventListener("click", (event) => {
      event.stopPropagation();
      event.preventDefault();
      fillWhatsAppContact();
    });

    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        event.preventDefault();
        fillWhatsAppContact();
      }
    });

    return button;
  }

  function positionWhatsAppFillButton(wrapper) {
    const saveBtn = document.querySelector('[data-testid="save-contact-btn"]');
    const firstInput = document.querySelector('[aria-label="First name"][contenteditable="true"]');

    if (!isWhatsAppContactFormOpen()) {
      wrapper.style.display = "none";
      return;
    }

    wrapper.style.display = "flex";

    if (saveBtn) {
      const rect = saveBtn.getBoundingClientRect();
      wrapper.style.left = `${rect.left + rect.width / 2 - 20}px`;
      wrapper.style.top = `${rect.top - 48}px`;
      return;
    }

    if (firstInput) {
      const rect = firstInput.getBoundingClientRect();
      wrapper.style.left = `${rect.right - 40}px`;
      wrapper.style.top = `${rect.bottom + 12}px`;
    }
  }

  function injectWhatsAppFillButton() {
    let wrapper = document.getElementById("mcf-whatsapp-fill-wrapper");

    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = "mcf-whatsapp-fill-wrapper";
      wrapper.setAttribute("data-mcf-whatsapp-fill-wrapper", "1");

      Object.assign(wrapper.style, {
        position: "fixed",
        zIndex: "999999",
        display: "none",
        alignItems: "center",
        justifyContent: "center",
        pointerEvents: "auto"
      });

      wrapper.appendChild(createWhatsAppFillButton());
      document.body.appendChild(wrapper);

      window.addEventListener("scroll", () => positionWhatsAppFillButton(wrapper), true);
      window.addEventListener("resize", () => positionWhatsAppFillButton(wrapper));
    }

    positionWhatsAppFillButton(wrapper);
  }

  function injectXeroFillButton() {
    if (document.querySelector('[data-mcf-xero-fill="1"]')) return;

    const footer = document.querySelector("footer .xui-actions");
    if (!footer) return;

    const button = document.createElement("button");
    button.type = "button";
    button.className = "xui-button xui-actions--secondary xui-button-standard xui-button-small";
    button.setAttribute("data-mcf-xero-fill", "1");
    button.textContent = "Fill from Monday";
    button.addEventListener("click", fillXeroContact);

    const cancelBtn = footer.querySelector("#btnCancel");

    if (cancelBtn) {
      footer.insertBefore(button, cancelBtn);
    } else {
      footer.prepend(button);
    }
  }

  let mondayObserverStarted = false;

  function runForCurrentSite() {
    const host = window.location.host;

    if (host.includes("monday.com")) {
      if (!isMondayBoardReady()) return;
      injectMondayRowButtons();
      return;
    }

    if (host === "web.whatsapp.com") {
      injectWhatsAppFillButton();
      return;
    }

    if (host.includes("xero.com")) {
      injectXeroFillButton();
    }
  }

  function debounce(fn, delay) {
    let timer;

    return function debounced() {
      clearTimeout(timer);
      timer = setTimeout(fn, delay);
    };
  }

  function startObserver() {
    if (mondayObserverStarted) return;
    mondayObserverStarted = true;

    const debouncedRun = debounce(runForCurrentSite, 200);
    debouncedRun();

    const observer = new MutationObserver(() => debouncedRun());
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  async function initForCurrentSite() {
    const host = window.location.host;

    if (host.includes("monday.com")) {
      await waitForMondayBoardReady();
      startObserver();
      return;
    }

    startObserver();
  }

  if (document.readyState === "complete") {
    initForCurrentSite();
  } else {
    window.addEventListener("load", () => initForCurrentSite(), { once: true });
  }
})();
