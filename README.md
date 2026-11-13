# Monday Contact Filler

Chrome extension to import an Expert Windows WPForms entry into monday, including its original pictures, and fill WhatsApp Web or Xero contact forms from monday contacts.

## Load the extension

1. Open `chrome://extensions` and enable Developer mode.
2. Choose **Load unpacked** and select this folder. If it is already loaded, click **Reload**.
3. Refresh the WordPress entry page. In its **Actions** sidebar, click **Import to monday**.

The import is available on `expertwindows.ie` and `www.expertwindows.ie`, on WPForms entry detail pages. Existing WhatsApp and Xero buttons remain available.

## Settings and local defaults

Open the extension's **Options**, or click **Import settings** beside the import action. Saved settings take priority over local defaults. You can set the API token, board ID, destination group title or ID, assignee user ID, workspace subdomain, and column mappings. **Load board columns** also loads group suggestions.

The default destination is board `5102605911`, group **Quoting in Progress** (group ID `group_title`). The local token is configured in `.env` and the generated `defaults.local.json`; both files are ignored by Git.

New imports are automatically assigned to user `74537460` in the board's People column. Change **Assign new imports to user ID** in settings, or set `MONDAY_ASSIGNEE_ID` in `.env`, to use another person. Leave the value blank to disable automatic assignment. The **Assigned salesperson (People)** mapping selects the assignment column.

To configure defaults on another checkout, copy `.env.example` to `.env`, enter your token, and run:

```sh
npm run configure
```

Run this again after changing `.env`, then reload the extension. Node 22 or later is required for configuration and tests. No server or Node installation is needed to run an already configured extension.

## Imported data

- Contact name becomes the item name. Email, phone, Eircode and message use matching board columns, with optional mapping overrides.
- Inquiry date uses the original WPForms submission date. Eircodes are extracted from the address/area fields or a separate Eircode field and normalized to uppercase with a space, for example `D02 KN34`.
- All displayed form fields, including address, message line breaks and consent, are preserved in an item update, together with the source entry link and submission date. Visible user journey data and saved entry notes are included when present.
- Original attachments are downloaded and uploaded to the files column. If no files column is mapped, they attach to the update. HEIC files keep their original bytes and filenames; preview support depends on monday.
- Columns are suggested automatically. You can leave them unmapped and still import the full submission in the update. Irish local numbers are normalized to `+353`; Irish and UK numbers populate phone columns, and all phone text is retained in the update.

The WordPress login is used for file downloads. The monday API token stays in the extension's background/settings contexts and is sent only to the monday API.

## Retry behavior

Import progress is saved per source entry and destination board in this browser profile. Repeated clicks or page reloads reuse the existing item. Failed downloads or rejected uploads can be retried with **Retry remaining import**, which skips confirmed uploads. Clearing extension storage or using another browser profile clears this local duplicate protection.

If a request loses its response after being sent to monday, its outcome is marked unconfirmed and automatic retries stop. Check the board/item before clearing that entry's `mcfImport:...` record in the extension's local storage; repeating an unconfirmed request can create a duplicate.

## Development checks

```sh
npm install
npm test
npx playwright install chromium
npm run test:browser
```

`npm test` covers extraction, sidebar interactions, settings, mapping, uploads, persistence, and retries. The browser test loads a temporary extension with a fake token and mocks every external request; it never writes to a live board. Set `PLAYWRIGHT_CHROMIUM_EXECUTABLE` to use an existing Chromium binary. Sidebar screenshots are saved under `test-results/`.

The implementation uses monday's [item mutations](https://developer.monday.com/api-reference/reference/items), [updates](https://developer.monday.com/api-reference/reference/updates), and [multipart file upload API](https://developer.monday.com/api-reference/reference/assets-1), pinned to API version `2026-10`.
