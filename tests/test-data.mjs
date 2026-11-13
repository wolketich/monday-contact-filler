import { readFileSync } from "node:fs";

export const root = new URL("../", import.meta.url);
export const source = (file) => readFileSync(new URL(file, root), "utf8");
export const pageUrl = "https://expertwindows.ie/wp-admin/admin.php?page=wpforms-entries&view=details&entry_id=1844";
export const board = {
  id: "5102605911",
  groups: [{ id: "topics", title: "Leads" }, { id: "group_title", title: "Quoting in Progress" }],
  columns: [
    { id: "name", title: "Name", type: "name" },
    { id: "person", title: "Asigned Sale Person", type: "people" },
    { id: "date4", title: "Inquiry date", type: "date" },
    { id: "date_mky44ttv", title: "Quote Sent Date", type: "date" },
    { id: "email_mkxpc0aq", title: "Customer Email", type: "email" },
    { id: "phone_mkxpfxef", title: "Customer Phone", type: "phone" },
    { id: "text_mm20s5jm", title: "Eircode", type: "text" },
    { id: "file_mkxp15zh", title: "Project Files", type: "file" },
    { id: "text_mm6rfa3e", title: "Project Details", type: "text" }
  ]
};
export const defaults = { mondayApiToken: "test-token", mondayBoardId: board.id, mondayGroupTitle: "Quoting in Progress", mondayAssigneeId: "74537460" };
export const jsonResponse = (data, status = 200) => new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json" } });
