import {
  addOrUpdateCard,
  getBoard,
  getMergedPRs,
  determineTypeScriptRelease,
} from "./gh.ts";
import type { Release } from "./types.ts";
import { getAssignee, getStatus } from "./utils.ts";

const board = await getBoard();
const prs = await getMergedPRs();

const existingPRItems = new Map<
  string,
  (typeof board)["items"]["nodes"][number]
>();
for (const item of board.items.nodes) {
  if (item.content?.url) {
    existingPRItems.set(item.content.url, item);
  }
}

for (const pr of prs) {
  const existing = existingPRItems.get(pr.url);
  const assignee = getAssignee(pr);
  const status = getStatus(pr);
  let release: Release | undefined;
  if (!existing?.release) {
    release = await determineTypeScriptRelease(pr.mergeCommit.oid);
  }

  await addOrUpdateCard(existing, pr, assignee, status, release);
}
