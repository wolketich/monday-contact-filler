import { test, expect, chromium } from "@playwright/test";
import { mkdtemp, copyFile, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { root, source, defaults, board, pageUrl } from "./test-data.mjs";

test("the installed extension imports a WPForms entry with pictures and remembers it after reload", async () => {
  const temporary = await mkdtemp(join(tmpdir(), "monday-extension-test-"));
  let context;
  try {
    const manifest = JSON.parse(source("manifest.json"));
    const files = new Set(["manifest.json", "background.js", "monday-import.js", "column-fields.js", "options.html", "options.js"]);
    for (const script of manifest.content_scripts) [...script.js, ...(script.css || [])].forEach((file) => files.add(file));
    for (const file of files) await copyFile(fileURLToPath(new URL(file, root)), join(temporary, file));
    await writeFile(join(temporary, "defaults.local.json"), JSON.stringify(defaults));

    context = await chromium.launchPersistentContext(join(temporary, "profile"), {
      headless: true,
      channel: "chromium",
      ...(process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE } : {}),
      args: [`--disable-extensions-except=${temporary}`, `--load-extension=${temporary}`],
      viewport: { width: 1280, height: 1000 }
    });
    const apiRequests = [];
    const downloads = [];
    await context.route("**/*", async (route) => {
      const request = route.request();
      const url = request.url();
      if (url.startsWith("chrome-extension://")) return route.continue();
      if (url === pageUrl) {
        const fixtureStyles = `<style>body{font:14px -apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif;background:#f0f0f1;color:#3c434a;padding:24px}h1{font-size:24px;font-weight:400}#post-body{display:grid;grid-template-columns:1fr 280px;gap:20px}.postbox{background:white;border:1px solid #c3c4c7;margin-bottom:20px}.postbox-header{border-bottom:1px solid #c3c4c7}h2{font-size:14px;padding:14px;margin:0}.inside{padding:16px}.wpforms-entry-field-name{font-weight:600}.wpforms-entry-field-item{padding:12px;border-bottom:1px solid #eee}.wpforms-hide{display:none}.wpforms-layout-row{display:flex;gap:20px}.wpforms-field-file-upload img{width:16px;height:16px}a,.button-link{color:#2271b1}.button{border:1px solid #2271b1;background:#f6f7f7;color:#2271b1;padding:4px 12px;border-radius:3px;cursor:pointer}.button:disabled{color:#a7aaad;border-color:#dcdcde}.button-link{border:0;background:transparent;padding:0;cursor:pointer}</style>`;
        return route.fulfill({ contentType: "text/html", body: source("tests/fixtures/wpforms-entry.html").replace("</head>", `${fixtureStyles}</head>`) });
      }
      if (url.startsWith("https://api.monday.com/")) {
        expect(request.headers().authorization).toBe("test-token");
        apiRequests.push(request);
        let data;
        if (url.endsWith("/file")) {
          const body = request.postDataBuffer().toString();
          expect(request.headers()["content-type"]).toContain("multipart/form-data; boundary=");
          expect(body).toContain("original-heic-bytes");
          expect(body).toContain("file_mkxp15zh");
          expect(body).toContain(".HEIC");
          data = { add_file_to_column: { id: String(apiRequests.length) } };
        } else {
          const query = request.postDataJSON().query;
          if (query.includes("create_item")) {
            const variables = request.postDataJSON().variables;
            expect(variables.groupId).toBe("group_title");
            expect(JSON.parse(variables.values).person).toEqual({ personsAndTeams: [{ id: 74537460, kind: "person" }] });
            expect(JSON.parse(variables.values).date4).toEqual({ date: "2026-11-11" });
            expect(JSON.parse(variables.values).text_mm20s5jm).toBe("D02 KN34");
            data = { create_item: { id: "901", url: "https://expertwindows.monday.com/boards/5102605911/pulses/901" } };
          } else if (query.includes("create_update")) data = { create_update: { id: "902" } };
          else data = { boards: [board] };
        }
        return route.fulfill({ contentType: "application/json", body: JSON.stringify({ data }) });
      }
      if (url.startsWith("https://expertwindows.ie/wp-content/uploads/")) {
        expect(request.headers().authorization).toBeUndefined();
        downloads.push(request);
        return route.fulfill({ contentType: "image/heic", body: "original-heic-bytes" });
      }
      // Extension resources are served by Chromium; every external request is mocked or blocked.
      return route.abort();
    });
    const worker = context.serviceWorkers()[0] || await context.waitForEvent("serviceworker");
    const extensionId = new URL(worker.url()).host;
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.goto(pageUrl);
    const button = page.getByRole("button", { name: "Import to monday", exact: true });
    await expect(button).toBeVisible();
    await page.locator("#postbox-container-1").screenshot({ path: "test-results/wpforms-actions-before.png" });
    await button.click();
    await expect(page.getByRole("button", { name: "Imported to monday", exact: true })).toBeDisabled();
    await expect(page.locator(".mcf-import-status")).toContainText("3 file(s) imported");
    expect(apiRequests.filter((request) => request.url().endsWith("/file"))).toHaveLength(3);
    expect(downloads.length).toBeGreaterThanOrEqual(3);
    await page.locator("#postbox-container-1").screenshot({ path: "test-results/wpforms-actions-imported.png" });
    const beforeReload = apiRequests.length;
    await page.reload();
    await expect(page.getByRole("button", { name: "Imported to monday", exact: true })).toBeDisabled();
    expect(apiRequests).toHaveLength(beforeReload);
    expect(errors).toEqual([]);

    const options = await context.newPage();
    options.on("pageerror", (error) => errors.push(error.message));
    await options.goto(`chrome-extension://${extensionId}/options.html`);
    await expect(options.locator("#mondayBoardId")).toHaveValue("5102605911");
    await expect(options.locator("#mondayGroupTitle")).toHaveValue("Quoting in Progress");
    await expect(options.locator("#mondayAssigneeId")).toHaveValue("74537460");
    await expect(options.locator("#column-assignee")).toHaveValue("person");
    await expect(options.locator("#column-inquiryDate")).toHaveValue("date4");
    await expect(options.locator("#column-files")).toHaveValue("file_mkxp15zh");
    await options.locator("#mondayGroupTitle").fill("group_title");
    await options.locator("#mondayAssigneeId").fill("12345678");
    await options.getByRole("button", { name: "Save settings", exact: true }).click();
    await expect(options.getByRole("status")).toHaveText("Settings saved.");
    await options.reload();
    await expect(options.locator("#mondayGroupTitle")).toHaveValue("group_title");
    await expect(options.locator("#mondayAssigneeId")).toHaveValue("12345678");
    expect(errors).toEqual([]);
  } finally {
    await context?.close();
    await rm(temporary, { recursive: true, force: true });
  }
});
