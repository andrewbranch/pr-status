import { addCardToBoard, getBoard, getMergedPRs } from "./gh.ts";
import { getAssignee, getStatus } from "./utils.ts";

const board = await getBoard();
const prs = await getMergedPRs();

const existingPRItems = new Set(
  board.items.nodes
    .filter((item) => item.content?.url)
    .map((item) => item.content!.url)
);

for (const pr of prs) {
  if (!existingPRItems.has(pr.url)) {
    const assignee = getAssignee(pr);
    const status = getStatus(pr);
    console.log(
      `Adding PR ${pr.url} to the board. Assignee: ${assignee}, Status: ${status}`
    );
    await addCardToBoard(pr, assignee, status);
  }
}
