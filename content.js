(() => {
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

  function getExtensionRuntime() {
    if (typeof chrome !== "undefined" && chrome.runtime?.id) {
      return chrome.runtime;
    }

    if (typeof browser !== "undefined" && browser.runtime?.id) {
      return browser.runtime;
    }

    return null;
  }

  function sendExtensionMessage(message) {
    const runtime = getExtensionRuntime();

    if (!runtime?.sendMessage) {
      return Promise.reject(
        new Error("Extension unavailable. Reload this page after updating the extension.")
      );
    }

    return new Promise((resolve, reject) => {
      try {
        runtime.sendMessage(message, (response) => {
          const lastError = chrome?.runtime?.lastError || browser?.runtime?.lastError;

          if (lastError?.message) {
            reject(new Error(lastError.message));
            return;
          }

          resolve(response);
        });
      } catch (error) {
        reject(error);
      }
    });
  }

  function openExtensionSettings() {
    const runtime = getExtensionRuntime();

    if (!runtime) {
      showToast("Reload this page, then open extension settings from chrome://extensions.");
      return;
    }

    sendExtensionMessage({ type: "openOptionsPage" })
      .catch(() => {
        if (typeof runtime.getURL === "function") {
          window.open(runtime.getURL("options.html"), "_blank", "noopener");
        }
      });
  }

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

  function getColumnText(columnValues, columnId) {
    const column = (columnValues || []).find((entry) => entry.id === columnId);
    return cleanText(column?.text || "");
  }

  function getPhoneFromColumn(columnValues, columnId) {
    const column = (columnValues || []).find((entry) => entry.id === columnId);
    if (!column) return "";

    const text = cleanText(column.text);
    if (text) return text;

    try {
      const parsed = JSON.parse(column.value || "{}");
      return cleanText(parsed.phone || "");
    } catch {
      return "";
    }
  }

  function mapMondayItemToLead(item, settings) {
    const columnMap = settings.mondayColumnMap || {};
    const columnValues = item.column_values || [];
    const fullName = cleanText(item.name);
    const { firstName, lastName } = splitName(fullName);

    const email = getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "email"));
    const phone = getPhoneFromColumn(columnValues, McfColumnFields.getColumnId(columnMap, "phone"));
    const parsedPhone = normalizeIrishPhone(phone);

    const location = getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "location"));
    const eircode = formatEircode(getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "eircode")));
    const houseNo = getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "houseNo"));

    const boardId = settings.mondayBoardId || "";
    const subdomain = settings.mondaySubdomain || "monday";
    const host = subdomain.includes(".") ? subdomain : `${subdomain}.monday.com`;

    return {
      fullName,
      firstName,
      lastName,
      email,
      phone: parsedPhone.raw || phone,
      phoneCountryCode: parsedPhone.countryCode,
      phoneAreaCode: parsedPhone.area,
      phoneNumber: parsedPhone.number,
      whatsappPhone: parsedPhone.localFormatted,
      location,
      eircode,
      houseNo,
      billingAddress: buildAddress({ houseNo, location, eircode }),
      quoteValue: getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "quoteValue")),
      quoteDate: getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "quoteDate")),
      status: getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "status")),
      projectDetails: getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "projectDetails")),
      mondayItemLink: boardId
        ? `https://${host}/boards/${boardId}/pulses/${item.id}`
        : "",
      savedAt: new Date().toISOString()
    };
  }

  async function getMondaySettings() {
    const response = await sendExtensionMessage({ type: "getMondaySettings" });

    if (!response?.ok) {
      throw new Error(response?.error || "Could not load Monday settings.");
    }

    return response.settings;
  }

  async function searchMondayItems(query) {
    const response = await sendExtensionMessage({
      type: "searchMondayItems",
      query
    });

    if (!response?.ok) {
      throw new Error(response?.error || "Monday search failed.");
    }

    return response.items || [];
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

  function getWhatsAppNameField(label) {
    const selectors = [
      `[aria-label="${label}"][contenteditable="true"]`,
      `[aria-label="${label}"] [contenteditable="true"]`
    ];

    for (const selector of selectors) {
      const element = document.querySelector(selector);
      if (element) return element;
    }

    return null;
  }

  function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function getEditableText(element) {
    return cleanText(element?.innerText || element?.textContent || "");
  }

  function dispatchKey(element, key, code, modifiers = {}) {
    const options = {
      key,
      code,
      bubbles: true,
      cancelable: true,
      ...modifiers
    };

    element.dispatchEvent(new KeyboardEvent("keydown", options));
    element.dispatchEvent(new KeyboardEvent("keyup", options));
  }

  async function clearWhatsAppEditable(element) {
    element.focus();
    await sleep(50);

    const selectAllModifier = navigator.platform.includes("Mac")
      ? { metaKey: true }
      : { ctrlKey: true };

    for (let attempt = 0; attempt < 6; attempt += 1) {
      if (!getEditableText(element)) break;

      dispatchKey(element, "a", "KeyA", selectAllModifier);
      await sleep(20);
      dispatchKey(element, "Backspace", "Backspace");
      dispatchKey(element, "Delete", "Delete");
      await sleep(20);

      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(element);
      selection.removeAllRanges();
      selection.addRange(range);
      document.execCommand("selectAll", false, null);
      document.execCommand("delete", false, null);
      selection.deleteFromDocument();
    }

    element.innerHTML = "";
    element.textContent = "";

    element.dispatchEvent(new InputEvent("beforeinput", {
      bubbles: true,
      cancelable: true,
      inputType: "deleteContentBackward"
    }));

    element.dispatchEvent(new InputEvent("input", {
      bubbles: true,
      inputType: "deleteContentBackward"
    }));

    await sleep(50);
  }

  async function setWhatsAppContentEditable(element, value) {
    if (!element) return false;

    const targetValue = cleanText(value);
    await clearWhatsAppEditable(element);

    if (!targetValue) {
      return true;
    }

    for (let attempt = 0; attempt < 2; attempt += 1) {
      if (getEditableText(element)) {
        await clearWhatsAppEditable(element);
      }

      element.focus();
      await sleep(50);

      document.execCommand("selectAll", false, null);
      document.execCommand("insertText", false, targetValue);

      await sleep(50);

      if (getEditableText(element) === targetValue) {
        element.dispatchEvent(new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: targetValue
        }));
        element.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }

    return getEditableText(element) === targetValue;
  }

  function formatEircode(eircode) {
    const compact = cleanText(eircode).replace(/\s+/g, "").toUpperCase();
    if (!compact) return "";

    if (/^[A-Z0-9]{7}$/.test(compact)) {
      return `${compact.slice(0, 3)} ${compact.slice(3)}`;
    }

    return compact;
  }

  function formatNameWithEircode(fullName, eircode) {
    let name = cleanText(fullName);
    if (!isUseful(eircode)) return name;

    const code = formatEircode(eircode);
    const suffixIndex = name.search(/\s\|\s/);

    if (suffixIndex !== -1) {
      name = name.slice(0, suffixIndex).trim();
    }

    return `${name} | ${code}`;
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

  async function fillWhatsAppContact(lead) {
    try {
      const firstInput = getWhatsAppNameField("First name");
      const lastInput = getWhatsAppNameField("Last name");
      const phoneInput = document.querySelector('input[data-testid="phone-number-input"], input[aria-label="Phone number"]');

      const whatsappNames = getWhatsAppNameValues(lead);

      const filledPhone = setNativeInput(phoneInput, lead.whatsappPhone || lead.phoneNumber || "");

      if (filledPhone) {
        await sleep(500);
      }

      const filledFirst = await setWhatsAppContentEditable(firstInput, whatsappNames.first);
      const filledLast = await setWhatsAppContentEditable(lastInput, whatsappNames.last);

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

  async function fillXeroContact(lead) {
    try {
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

      if (billingAddressInput && isUseful(lead.eircode)) {
        setNativeInput(billingAddressInput, lead.eircode);
        billingAddressInput.focus();
      }

      showToast("Filled Xero. Pick the address from the eircode result.");
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
      zIndex: "10000000",
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

  function debounce(fn, delay) {
    let timer;

    return function debounced(...args) {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), delay);
    };
  }

  function getItemSubtitle(item, columnMap) {
    const columnValues = item.column_values || [];
    const eircode = formatEircode(getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "eircode")));
    const status = getColumnText(columnValues, McfColumnFields.getColumnId(columnMap, "status"));
    const parts = [];

    if (isUseful(eircode)) parts.push(eircode);
    if (isUseful(status)) parts.push(status);

    return parts.join(" · ");
  }

  function openMondaySearchModal(onSelect) {
    const existing = document.getElementById("mcf-search-modal");
    if (existing) existing.remove();

    const overlay = document.createElement("div");
    overlay.id = "mcf-search-modal";

    Object.assign(overlay.style, {
      position: "fixed",
      inset: "0",
      zIndex: "9999999",
      background: "rgba(0, 0, 0, 0.45)",
      display: "flex",
      alignItems: "flex-start",
      justifyContent: "center",
      padding: "80px 16px 16px",
      fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif"
    });

    const panel = document.createElement("div");
    Object.assign(panel.style, {
      width: "100%",
      maxWidth: "420px",
      background: "#fff",
      borderRadius: "12px",
      boxShadow: "0 12px 40px rgba(0,0,0,0.25)",
      overflow: "hidden"
    });

    const header = document.createElement("div");
    header.textContent = "Search Monday";
    Object.assign(header.style, {
      padding: "16px 16px 8px",
      fontSize: "16px",
      fontWeight: "600",
      color: "#1f1f1f"
    });

    const input = document.createElement("input");
    input.type = "text";
    input.placeholder = "Search Monday by name…";
    Object.assign(input.style, {
      display: "block",
      width: "calc(100% - 32px)",
      margin: "0 16px 12px",
      padding: "10px 12px",
      border: "1px solid #d0d4e4",
      borderRadius: "8px",
      fontSize: "14px",
      boxSizing: "border-box"
    });

    const status = document.createElement("div");
    Object.assign(status.style, {
      padding: "0 16px 12px",
      fontSize: "13px",
      color: "#676879",
      minHeight: "18px"
    });

    const results = document.createElement("div");
    Object.assign(results.style, {
      maxHeight: "320px",
      overflowY: "auto",
      borderTop: "1px solid #eceff5"
    });

    const settingsLink = document.createElement("button");
    settingsLink.type = "button";
    settingsLink.textContent = "Open extension settings";
    Object.assign(settingsLink.style, {
      display: "none",
      margin: "0 16px 16px",
      padding: "0",
      border: "none",
      background: "none",
      color: "#0073ea",
      fontSize: "13px",
      cursor: "pointer",
      textDecoration: "underline"
    });

    settingsLink.addEventListener("click", () => {
      openExtensionSettings();
    });

    panel.append(header, input, status, results, settingsLink);
    overlay.appendChild(panel);
    document.body.appendChild(overlay);

    let searchGeneration = 0;
    let settingsCache = null;

    function closeModal() {
      overlay.remove();
      document.removeEventListener("keydown", onKeyDown);
    }

    function onKeyDown(event) {
      if (event.key === "Escape") closeModal();
    }

    document.addEventListener("keydown", onKeyDown);

    overlay.addEventListener("click", (event) => {
      if (event.target === overlay) closeModal();
    });

    function renderResults(items) {
      results.innerHTML = "";

      if (!items.length) {
        status.textContent = "No items found.";
        return;
      }

      status.textContent = `${items.length} result${items.length === 1 ? "" : "s"}`;

      for (const item of items) {
        const row = document.createElement("button");
        row.type = "button";
        Object.assign(row.style, {
          display: "block",
          width: "100%",
          padding: "12px 16px",
          border: "none",
          borderBottom: "1px solid #eceff5",
          background: "#fff",
          textAlign: "left",
          cursor: "pointer"
        });

        const title = document.createElement("div");
        title.textContent = item.name;
        Object.assign(title.style, {
          fontSize: "14px",
          fontWeight: "600",
          color: "#1f1f1f"
        });

        const subtitle = document.createElement("div");
        subtitle.textContent = getItemSubtitle(item, settingsCache?.mondayColumnMap || {});
        Object.assign(subtitle.style, {
          fontSize: "12px",
          color: "#676879",
          marginTop: "2px"
        });

        row.append(title);
        if (subtitle.textContent) row.append(subtitle);

        row.addEventListener("mouseenter", () => {
          row.style.background = "#f5f6f8";
        });

        row.addEventListener("mouseleave", () => {
          row.style.background = "#fff";
        });

        row.addEventListener("click", async () => {
          try {
            if (!settingsCache) {
              settingsCache = await getMondaySettings();
            }

            const lead = mapMondayItemToLead(item, settingsCache);
            closeModal();
            await onSelect(lead);
          } catch (error) {
            status.textContent = error.message || "Could not use selected item.";
            status.style.color = "#c62828";
          }
        });

        results.appendChild(row);
      }
    }

    const runSearch = debounce(async (query) => {
      const generation = ++searchGeneration;

      if (query.length < 2) {
        status.textContent = "Type at least 2 characters to search.";
        status.style.color = "#676879";
        results.innerHTML = "";
        return;
      }

      status.textContent = "Searching…";
      status.style.color = "#676879";
      results.innerHTML = "";

      try {
        if (!settingsCache) {
          settingsCache = await getMondaySettings();
        }

        if (!settingsCache.mondayApiToken || !settingsCache.mondayBoardId) {
          status.textContent = "Configure API token and board ID in extension settings.";
          status.style.color = "#c62828";
          settingsLink.style.display = "block";
          return;
        }

        if (!McfColumnFields.getConfiguredColumnIds(settingsCache.mondayColumnMap).length) {
          status.textContent = "Map Monday columns in extension settings.";
          status.style.color = "#c62828";
          settingsLink.style.display = "block";
          return;
        }

        settingsLink.style.display = "none";
        const items = await searchMondayItems(query);

        if (generation !== searchGeneration) return;

        renderResults(items);
        status.style.color = "#676879";
      } catch (error) {
        if (generation !== searchGeneration) return;

        status.textContent = error.message || "Search failed.";
        status.style.color = "#c62828";

        if ((error.message || "").includes("settings")) {
          settingsLink.style.display = "block";
        }
      }
    }, 300);

    input.addEventListener("input", () => runSearch(input.value.trim()));

    getMondaySettings()
      .then((settings) => {
        settingsCache = settings;

        if (!settings.mondayApiToken || !settings.mondayBoardId) {
          status.textContent = "Configure API token and board ID in extension settings.";
          status.style.color = "#c62828";
          settingsLink.style.display = "block";
        } else if (!McfColumnFields.getConfiguredColumnIds(settings.mondayColumnMap).length) {
          status.textContent = "Map Monday columns in extension settings.";
          status.style.color = "#c62828";
          settingsLink.style.display = "block";
        } else {
          status.textContent = "Type at least 2 characters to search.";
        }
      })
      .catch((error) => {
        status.textContent = error.message || "Could not load settings.";
        status.style.color = "#c62828";
        settingsLink.style.display = "block";
      });

    setTimeout(() => input.focus(), 0);
  }

  function openFillFromMonday(fillFn) {
    openMondaySearchModal(async (lead) => {
      await fillFn(lead);
    });
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
      width: "48px",
      height: "48px",
      cursor: "pointer",
      borderRadius: "50%",
      color: "#ffffff",
      background: "#111111",
      border: "none",
      boxShadow: "0 2px 12px rgba(0, 0, 0, 0.45)"
    });

    button.appendChild(createCopyIconSvg(22));

    button.addEventListener("mouseenter", () => {
      button.style.background = "#2a2a2a";
      button.style.transform = "scale(1.05)";
    });

    button.addEventListener("mouseleave", () => {
      button.style.background = "#111111";
      button.style.transform = "scale(1)";
    });

    const handleFill = (event) => {
      event.stopPropagation();
      event.preventDefault();
      openFillFromMonday(fillWhatsAppContact);
    };

    button.addEventListener("click", handleFill);

    button.addEventListener("keydown", (event) => {
      if (event.key === "Enter" || event.key === " ") {
        handleFill(event);
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
      wrapper.style.left = `${rect.left + rect.width / 2 - 24}px`;
      wrapper.style.top = `${rect.top - 56}px`;
      return;
    }

    if (firstInput) {
      const rect = firstInput.getBoundingClientRect();
      wrapper.style.left = `${rect.right - 48}px`;
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
    button.addEventListener("click", () => openFillFromMonday(fillXeroContact));

    const cancelBtn = footer.querySelector("#btnCancel");

    if (cancelBtn) {
      footer.insertBefore(button, cancelBtn);
    } else {
      footer.prepend(button);
    }
  }

  function runForCurrentSite() {
    const host = window.location.host;

    if (host === "web.whatsapp.com") {
      injectWhatsAppFillButton();
      return;
    }

    if (host.includes("xero.com")) {
      injectXeroFillButton();
    }
  }

  function startObserver() {
    const debouncedRun = debounce(runForCurrentSite, 200);
    debouncedRun();

    const observer = new MutationObserver(() => debouncedRun());
    observer.observe(document.body, {
      childList: true,
      subtree: true
    });
  }

  if (document.readyState === "complete") {
    startObserver();
  } else {
    window.addEventListener("load", () => startObserver(), { once: true });
  }
})();
