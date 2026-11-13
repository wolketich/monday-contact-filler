import vm from "node:vm";
import { JSDOM } from "jsdom";
import { source, pageUrl, board, defaults, jsonResponse } from "./test-data.mjs";
export * from "./test-data.mjs";

export function fixtureDom() {
  const dom = new JSDOM(source("tests/fixtures/wpforms-entry.html"), { url: pageUrl, runScripts: "outside-only" });
  vm.runInContext(source("wpforms-entry.js") + ";globalThis.entryParser = McfWpformsEntry;", dom.getInternalVMContext());
  const close = dom.window.close.bind(dom.window);
  dom.window.close = () => {
    dom.window.dispatchEvent(new dom.window.Event("pagehide"));
    close();
  };
  return dom;
}

export function parsedEntry() {
  const dom = fixtureDom();
  const entry = JSON.parse(JSON.stringify(dom.window.entryParser.parse(dom.window.document, pageUrl)));
  dom.window.close();
  return entry;
}

export function backgroundHarness({ saved = {}, defaultValues = defaults, apiHandler, downloadHandler } = {}) {
  const storage = structuredClone(saved);
  const requests = [];
  let listener;
  const chrome = {
    storage: { local: {
      setAccessLevel: async () => {},
      get: async (keys) => Object.fromEntries((Array.isArray(keys) ? keys : [keys]).filter((key) => key in storage).map((key) => [key, structuredClone(storage[key])])),
      set: async (values) => Object.assign(storage, structuredClone(values))
    } },
    runtime: {
      getURL: (path) => `chrome-extension://test-extension/${path}`,
      openOptionsPage: async () => {},
      onMessage: { addListener: (fn) => { listener = fn; } }
    }
  };
  let uploadCount = 0;
  const context = vm.createContext({
    chrome, URL, AbortSignal, FormData, Blob, console,
    fetch: async (url, options) => {
      if (url.startsWith("chrome-extension://")) return jsonResponse(defaultValues);
      requests.push({ url, options });
      if (url.startsWith("https://expertwindows.ie/")) {
        if (downloadHandler) return downloadHandler(url, options);
        const response = new Response("original-heic-bytes", { headers: { "Content-Type": "image/heic" } });
        Object.defineProperty(response, "url", { value: url });
        return response;
      }
      const body = options.body instanceof FormData ? null : JSON.parse(options.body);
      if (apiHandler) {
        const result = await apiHandler({ url, options, body });
        if (result) return result;
      }
      if (url.endsWith("/file")) {
        const query = options.body.get("query");
        const mutation = query.includes("add_file_to_column") ? "add_file_to_column" : "add_file_to_update";
        return jsonResponse({ data: { [mutation]: { id: String(++uploadCount) } } });
      }
      if (body.query.includes("create_item")) return jsonResponse({ data: { create_item: { id: "901", url: "https://expertwindows.monday.com/boards/5102605911/pulses/901" } } });
      if (body.query.includes("create_update")) return jsonResponse({ data: { create_update: { id: "902" } } });
      if (body.query.includes("SearchBoardItems")) return jsonResponse({ data: { boards: [{ items_page: { items: [] } }] } });
      return jsonResponse({ data: { boards: [board] } });
    }
  });
  context.importScripts = (...files) => files.forEach((file) => vm.runInContext(source(file), context, { filename: file }));
  vm.runInContext(source("background.js"), context, { filename: "background.js" });
  const message = (data, senderUrl = pageUrl) => new Promise((resolve, reject) => {
    try {
      const async = listener(data, { url: senderUrl }, resolve);
      if (!async) resolve(undefined);
    } catch (error) { reject(error); }
  });
  return { message, storage, requests, context, optionsUrl: chrome.runtime.getURL("options.html") };
}
