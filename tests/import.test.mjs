import test from "node:test";
import assert from "node:assert/strict";
import { backgroundHarness, parsedEntry, pageUrl, jsonResponse, defaults } from "./helpers.mjs";

const itemRequests = (harness) => harness.requests.filter((request) => typeof request.options.body === "string" && JSON.parse(request.options.body).query.includes("create_item"));
const uploadRequests = (harness) => harness.requests.filter((request) => request.url.endsWith("/file"));

test("imports the contact to the requested group, full details and three original HEIC uploads", async () => {
  const harness = backgroundHarness();
  const response = await harness.message({ type: "importWpformsEntry", entry: parsedEntry() });
  assert.equal(response.ok, true);
  assert.equal(response.state.complete, true);
  const item = JSON.parse(itemRequests(harness)[0].options.body).variables;
  assert.equal(item.boardId, "5102605911");
  assert.equal(item.groupId, "group_title");
  assert.equal(item.name, "Alex Murphy");
  const values = JSON.parse(item.values);
  assert.deepEqual(values.person, { personsAndTeams: [{ id: 74537460, kind: "person" }] });
  assert.deepEqual(values.date4, { date: "2026-11-11" });
  assert.equal(values.date_mky44ttv, undefined, "the inquiry must not populate the quote date");
  assert.deepEqual(values.email_mkxpc0aq, { email: "alex@example.test", text: "alex@example.test" });
  assert.deepEqual(values.phone_mkxpfxef, { phone: "+353857278559", countryShortName: "IE" });
  assert.equal(values.text_mm20s5jm, "D02 KN34");
  assert.match(values.text_mm6rfa3e, /secondary glazing/);
  const update = harness.requests.map((request) => typeof request.options.body === "string" ? JSON.parse(request.options.body) : null).find((body) => body?.query.includes("create_update"));
  assert.match(update.variables.body, /I agree to contact/);
  assert.match(update.variables.body, /Nov 11, 2026 at 2:33 pm/);
  assert.match(update.variables.body, /User journey/);
  assert.doesNotMatch(update.variables.body, /addon demo|Duplicate hidden|Hidden field help/);
  assert.equal(uploadRequests(harness).length, 3);
  for (const { options } of uploadRequests(harness)) {
    assert.equal(options.headers.Authorization, "test-token");
    assert.equal(options.headers["Content-Type"], undefined, "browser supplies the multipart boundary");
    assert.equal(options.body.get("map"), '{"upload":"variables.file"}');
    assert.match(options.body.get("query"), /column_id: "file_mkxp15zh"/);
    assert.match(options.body.get("upload").name, /\.HEIC$/);
    assert.equal(await options.body.get("upload").text(), "original-heic-bytes");
  }
  for (const { options } of harness.requests.filter((request) => request.url.startsWith("https://expertwindows.ie/"))) {
    assert.equal(options.credentials, "include");
    assert.equal(options.headers, undefined, "never send the monday token to WordPress");
  }
});

test("repeated imports, including after a worker restart, reuse the completed item", async () => {
  const harness = backgroundHarness();
  const message = { type: "importWpformsEntry", entry: parsedEntry() };
  const [first, second] = await Promise.all([harness.message(message), harness.message(message)]);
  assert.equal(first.state.itemId, second.state.itemId);
  assert.equal(itemRequests(harness).length, 1);
  const restarted = backgroundHarness({ saved: harness.storage });
  assert.equal((await restarted.message(message)).state.complete, true);
  assert.equal(restarted.requests.length, 0);
});

test("a failed upload resumes only the missing file without creating another contact or update", async () => {
  let fail = true;
  const harness = backgroundHarness({ apiHandler: ({ options, url }) => {
    if (url.endsWith("/file") && options.body.get("upload").name === "IMG_7388.HEIC" && fail) {
      return jsonResponse({ errors: [{ message: "Temporary file validation failure" }] });
    }
  } });
  const message = { type: "importWpformsEntry", entry: parsedEntry() };
  const first = await harness.message(message);
  assert.equal(first.ok, true);
  assert.equal(first.state.complete, false);
  assert.equal(Object.keys(first.state.uploadedFiles).length, 2);
  assert.match(first.failures[0], /IMG_7388.HEIC/);
  fail = false;
  const second = await harness.message(message);
  assert.equal(second.state.complete, true);
  assert.equal(itemRequests(harness).length, 1);
  assert.equal(uploadRequests(harness).length, 4);
});

test("an update failure resumes the same contact", async () => {
  let fail = true;
  const harness = backgroundHarness({ apiHandler: ({ body }) => body?.query.includes("create_update") && fail
    ? jsonResponse({ errors: [{ message: "Update permission denied" }] }) : null });
  const message = { type: "importWpformsEntry", entry: parsedEntry() };
  const first = await harness.message(message);
  assert.equal(first.ok, false);
  assert.equal(first.state.itemId, "901");
  assert.equal(first.state.pendingStep, undefined);
  fail = false;
  assert.equal((await harness.message(message)).state.complete, true);
  assert.equal(itemRequests(harness).length, 1);
});

test("uploads attach to the update when a files column is explicitly unmapped", async () => {
  const harness = backgroundHarness({ saved: { mondayColumnMap: { files: "" } } });
  assert.equal((await harness.message({ type: "importWpformsEntry", entry: parsedEntry() })).state.complete, true);
  for (const upload of uploadRequests(harness)) assert.match(upload.options.body.get("query"), /add_file_to_update\(update_id: 902/);
});

test("missing group and invalid column mappings fail before any writes", async () => {
  for (const saved of [{ mondayGroupTitle: "Missing group" }, { mondayColumnMap: { email: "not-a-column" } }, { mondayColumnMap: { files: "name" } }]) {
    const harness = backgroundHarness({ saved });
    const response = await harness.message({ type: "importWpformsEntry", entry: parsedEntry() });
    assert.equal(response.ok, false);
    assert.equal(itemRequests(harness).length, 0);
  }
});

test("group IDs and case-insensitive group titles work", async () => {
  for (const mondayGroupTitle of ["group_title", "  quoting IN progress  "]) {
    const harness = backgroundHarness({ saved: { mondayGroupTitle } });
    assert.equal((await harness.message({ type: "importWpformsEntry", entry: parsedEntry() })).ok, true);
    assert.equal(JSON.parse(itemRequests(harness)[0].options.body).variables.groupId, "group_title");
  }
});

test("assignee settings override the default and can disable automatic assignment", async () => {
  for (const mondayAssigneeId of ["12345678", ""]) {
    const harness = backgroundHarness({ saved: { mondayAssigneeId } });
    const result = await harness.message({ type: "importWpformsEntry", entry: parsedEntry() });
    assert.equal(result.ok, true);
    const values = JSON.parse(JSON.parse(itemRequests(harness)[0].options.body).variables.values);
    if (mondayAssigneeId) assert.deepEqual(values.person, { personsAndTeams: [{ id: 12345678, kind: "person" }] });
    else assert.equal(values.person, undefined);
  }
});

test("invalid assignee IDs and missing People mappings fail before creating a contact", async () => {
  for (const saved of [
    { mondayAssigneeId: "not-a-user" },
    { mondayAssigneeId: "0" },
    { mondayAssigneeId: "9007199254740993" },
    { mondayColumnMap: { assignee: "name" } },
    { mondayColumnMap: { assignee: "" } }
  ]) {
    const harness = backgroundHarness({ saved });
    const result = await harness.message({ type: "importWpformsEntry", entry: parsedEntry() });
    assert.equal(result.ok, false);
    assert.match(result.error, /assignee/i);
    assert.equal(itemRequests(harness).length, 0);
  }
});

test("unreadable and impossible submission dates are not replaced with today's date", async () => {
  for (const inquiryDate of ["", "2026-02-31"]) {
    const harness = backgroundHarness();
    const result = await harness.message({ type: "importWpformsEntry", entry: { ...parsedEntry(), inquiryDate } });
    assert.equal(result.ok, false);
    assert.match(result.error, /submission date/);
    assert.equal(itemRequests(harness).length, 0);
  }
});

test("rejects messages from other sites, different entry IDs, and external picture links", async () => {
  for (const [entry, sender] of [
    [parsedEntry(), "https://web.whatsapp.com/"],
    [parsedEntry(), pageUrl.replace("1844", "1845")],
    [{ ...parsedEntry(), attachments: [{ name: "file.heic", url: "https://other.example/file.heic" }] }, pageUrl]
  ]) {
    const harness = backgroundHarness();
    assert.equal((await harness.message({ type: "importWpformsEntry", entry }, sender)).ok, false);
    assert.equal(harness.requests.length, 0);
  }
});

test("login pages and empty files are failures and do not get uploaded", async () => {
  for (const downloadHandler of [
    () => new Response("Please log in", { headers: { "Content-Type": "text/html" } }),
    () => new Response("", { headers: { "Content-Type": "image/heic" } })
  ]) {
    const harness = backgroundHarness({ downloadHandler });
    const result = await harness.message({ type: "importWpformsEntry", entry: parsedEntry() });
    assert.equal(result.state.complete, false);
    assert.equal(result.failures.length, 3);
    assert.equal(uploadRequests(harness).length, 0);
  }
});

test("unknown mutation outcomes are persisted and never blindly repeated", async () => {
  const harness = backgroundHarness({ apiHandler: ({ body }) => {
    if (body?.query.includes("create_item")) throw new TypeError("Network lost after sending");
  } });
  const message = { type: "importWpformsEntry", entry: parsedEntry() };
  const first = await harness.message(message);
  assert.equal(first.ok, false);
  assert.equal(first.state.pendingStep, "create_item");
  const restarted = backgroundHarness({ saved: harness.storage });
  const second = await restarted.message(message);
  assert.equal(second.ok, false);
  assert.match(second.error, /unconfirmed/);
  assert.equal(restarted.requests.length, 0);
});

test("settings overrides defaults and content scripts never receive the API token", async () => {
  const harness = backgroundHarness({ saved: { mondayGroupTitle: "New leads" } });
  const publicResult = await harness.message({ type: "getMondaySettings" });
  assert.equal(publicResult.settings.mondayApiToken, undefined);
  assert.equal(publicResult.settings.mondayApiTokenConfigured, true);
  assert.equal(publicResult.settings.mondayBoardId, defaults.mondayBoardId);
  assert.equal(publicResult.settings.mondayGroupTitle, "New leads");
  const privateResult = await harness.message({ type: "getMondaySettings" }, harness.optionsUrl);
  assert.equal(privateResult.settings.mondayApiToken, "test-token");
});
