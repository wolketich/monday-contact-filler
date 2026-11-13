import test from "node:test";
import assert from "node:assert/strict";
import { JSDOM } from "jsdom";
import { fixtureDom, pageUrl, source, defaults, board } from "./helpers.mjs";

const settle = () => new Promise((resolve) => setTimeout(resolve, 20));

test("extracts nested fields and multiline messages without hidden labels or duplicate image icons", () => {
  const dom = fixtureDom();
  const entry = dom.window.entryParser.parse(dom.window.document, pageUrl);
  assert.equal(entry.fullName, "Alex Murphy");
  assert.equal(entry.email, "alex@example.test");
  assert.equal(entry.eircode, "D02 KN34");
  assert.equal(entry.message, "Hi,\n\nI would like secondary glazing & a quote.\n\nBest Regards,\nAlex Murphy");
  assert.equal(entry.attachments.length, 3);
  assert.equal(entry.fields.length, 7);
  assert.equal(entry.fields[5].label, "Upload pictures (optional)");
  assert.equal(entry.formId, "7547");
  assert.equal(entry.inquiryDate, "2026-11-11");
  dom.window.close();
});

test("extracts and normalizes Eircodes within full addresses and separate postcode fields", () => {
  const dom = fixtureDom();
  const document = dom.window.document;
  const address = document.querySelector(".wpforms-field-text .wpforms-entry-field-value");
  for (const [value, expected] of [
    ["Apartment 4, 12 Example Street, Dublin 2, d02kn34", "D02 KN34"],
    ["12 Example Road\nDublin 6W\nD6W WN40", "D6W WN40"],
    ["Dublin, d02-kn34, Ireland", "D02 KN34"],
    ["12 Example Street, Dublin 2", ""]
  ]) {
    address.textContent = value;
    assert.equal(dom.window.entryParser.parse(document, pageUrl).eircode, expected);
  }
  const extraField = document.createElement("div");
  extraField.className = "wpforms-entry-field-item";
  extraField.innerHTML = '<p class="wpforms-entry-field-name">Eircode</p><div class="wpforms-entry-field-value">D02 KN34</div>';
  document.querySelector(".wpforms-entries-fields-wrapper").append(extraField);
  assert.equal(dom.window.entryParser.parse(document, pageUrl).eircode, "D02 KN34");
  dom.window.close();
});

test("submission dates preserve the calendar date across supported WordPress formats", () => {
  const dom = fixtureDom();
  const parse = dom.window.entryParser.parseSubmissionDate;
  for (const text of ["Nov 11, 2026 at 2:33 pm", "November 11, 2026", "11 November 2026", "11/11/2026", "2026-11-11T23:33:00-05:00"]) {
    assert.equal(parse(text), "2026-11-11");
  }
  assert.equal(parse("Feb 29, 2024"), "2024-02-29");
  for (const text of ["Feb 29, 2026", "2026-13-11", "No date", ""]) assert.equal(parse(text), "");
  dom.window.close();
});

test("missing names and untrusted uploads show actionable extraction errors", () => {
  const dom = fixtureDom();
  const document = dom.window.document;
  document.querySelector(".wpforms-field-name .wpforms-entry-field-value").textContent = "";
  assert.throws(() => dom.window.entryParser.parse(document, pageUrl), /no contact name/);
  document.querySelector(".wpforms-field-name .wpforms-entry-field-value").textContent = "Alex Murphy";
  document.querySelector(".wpforms-field-file-upload a").href = "javascript:alert(1)";
  assert.throws(() => dom.window.entryParser.parse(document, pageUrl), /outside this site's uploads/);
  dom.window.close();
});

test("the Actions sidebar imports once, shows success, and opens extension settings", async () => {
  const dom = fixtureDom();
  const messages = [];
  dom.window.chrome = { runtime: { sendMessage: async (message) => {
    messages.push(message);
    return message.type === "importWpformsEntry" ? {
      ok: true, state: { complete: true, itemId: "901", itemUrl: "https://expertwindows.monday.com/boards/5102605911/pulses/901", uploadedFiles: { a: {}, b: {}, c: {} } }
    } : { ok: true, state: null };
  } } };
  dom.window.eval(source("wpforms-content.js"));
  await settle();
  const container = dom.window.document.querySelector("#wpforms-entry-actions #mcf-monday-import");
  assert.ok(container);
  container.querySelector(".button").click();
  await settle();
  assert.equal(messages.filter((message) => message.type === "importWpformsEntry").length, 1);
  assert.equal(container.querySelector(".button").disabled, true);
  assert.equal(container.querySelector(".button").textContent, "Imported to monday");
  assert.match(container.querySelector('[role="status"]').textContent, /3 file/);
  assert.equal(container.querySelector("a").hidden, false);
  assert.equal(dom.window.document.querySelectorAll("#mcf-monday-import").length, 1);
  container.querySelector(".mcf-import-settings").click();
  await settle();
  assert.equal(messages.at(-1).type, "openOptionsPage");
  dom.window.close();
});

test("partial imports keep an item link and a retry button", async () => {
  const dom = fixtureDom();
  dom.window.chrome = { runtime: { sendMessage: async (message) => message.type === "importWpformsEntry" ? {
    ok: true, state: { complete: false, itemId: "901", itemUrl: "https://expertwindows.monday.com/boards/5102605911/pulses/901" }, failures: ["IMG_7388.HEIC: Download failed."]
  } : { ok: true, state: null } } };
  dom.window.eval(source("wpforms-content.js"));
  await settle();
  dom.window.document.querySelector("#mcf-monday-import .button").click();
  await settle();
  assert.equal(dom.window.document.querySelector("#mcf-monday-import .button").disabled, false);
  assert.match(dom.window.document.querySelector("#mcf-monday-import .button").textContent, /Retry/);
  assert.match(dom.window.document.querySelector(".mcf-import-status").textContent, /IMG_7388.HEIC/);
  dom.window.close();
});

test("settings show effective defaults and can save credentials without required mappings", async () => {
  const dom = new JSDOM(source("options.html"), { url: "https://extension.example/options.html", runScripts: "outside-only" });
  let saved;
  dom.window.chrome = {
    runtime: { sendMessage: async (message) => message.type === "getMondaySettings"
      ? { ok: true, settings: { ...defaults, mondayColumnMap: {} } }
      : { ok: true, columns: board.columns, groups: board.groups } },
    storage: { local: { set: async (values) => { saved = values; } } }
  };
  dom.window.eval(source("column-fields.js") + "\n" + source("options.js"));
  await settle();
  const document = dom.window.document;
  assert.equal(document.querySelector("#mondayBoardId").value, "5102605911");
  assert.equal(document.querySelector("#mondayGroupTitle").value, "Quoting in Progress");
  assert.equal(document.querySelector("#mondayAssigneeId").value, "74537460");
  assert.equal(document.querySelector("#column-assignee").value, "person");
  assert.equal(document.querySelector("#column-inquiryDate").value, "date4");
  assert.equal(document.querySelector("#column-quoteDate").value, "date_mky44ttv");
  assert.equal(document.querySelector("#column-files").value, "file_mkxp15zh");
  document.querySelector("#mondayBoardId").value = "123456";
  document.querySelector("#mondayGroupTitle").value = "New leads";
  document.querySelector("#mondayAssigneeId").value = "12345678";
  document.querySelector("#settings-form").dispatchEvent(new dom.window.Event("submit", { cancelable: true }));
  await settle();
  assert.equal(saved.mondayBoardId, "123456");
  assert.equal(saved.mondayGroupTitle, "New leads");
  assert.equal(saved.mondayAssigneeId, "12345678");
  assert.equal(Object.keys(saved.mondayColumnMap).length, 0, "old board mappings must not carry over");
  dom.window.close();
});
