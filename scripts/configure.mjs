import { readFile, writeFile, chmod } from "node:fs/promises";
import { parseEnv } from "node:util";

const root = new URL("../", import.meta.url);

try {
  const values = parseEnv(await readFile(new URL(".env", root), "utf8"));
  const defaults = {
    mondayApiToken: values.MONDAY_API_TOKEN?.trim() || "",
    mondayBoardId: values.MONDAY_BOARD_ID?.trim() || "5102605911",
    mondayGroupTitle: values.MONDAY_GROUP_TITLE?.trim() || "Quoting in Progress",
    mondayAssigneeId: values.MONDAY_ASSIGNEE_ID?.trim() ?? "74537460",
    mondaySubdomain: values.MONDAY_SUBDOMAIN?.trim() || ""
  };

  if (!defaults.mondayApiToken || !/^\d+$/.test(defaults.mondayBoardId)) {
    throw new Error("Set MONDAY_API_TOKEN and a numeric MONDAY_BOARD_ID in .env.");
  }
  if (defaults.mondayAssigneeId && (!/^[1-9]\d*$/.test(defaults.mondayAssigneeId) || !Number.isSafeInteger(Number(defaults.mondayAssigneeId)))) {
    throw new Error("MONDAY_ASSIGNEE_ID must be a positive numeric user ID, or blank to disable automatic assignment.");
  }

  const target = new URL("defaults.local.json", root);
  await writeFile(target, JSON.stringify(defaults, null, 2) + "\n", { mode: 0o600 });
  await chmod(target, 0o600);
  await chmod(new URL(".env", root), 0o600);
  console.log("Local defaults generated. Reload the extension in chrome://extensions.");
} catch (error) {
  console.error(error.code === "ENOENT" ? "Copy .env.example to .env, enter your token, then run npm run configure." : error.message);
  process.exitCode = 1;
}
