import {
  getBoard,
  searchTypeScriptGoIssues,
  getTypeScriptPRDetails,
  createTypeScriptGoIssue,
} from "./gh.ts";
import type { BoardItem } from "./types.ts";

// Set to true to preview issues without creating them
const DRY_RUN = process.env.DRY_RUN === "true";
const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT, 10) : 10;

console.log("Starting issue creation process...");

if (DRY_RUN) {
  console.log("🔍 DRY RUN MODE - No issues will be created");
}

const board = await getBoard();
const itemsToProcess = filterItemsForIssueCreation(board.items.nodes);

console.log(
  `Found ${itemsToProcess.length} items to process for issue creation`
);

let processedCount = 0;
for (const item of itemsToProcess) {
  if (processedCount >= LIMIT) {
    console.log(`Reached limit of ${LIMIT} processed items, stopping`);
    break;
  }

  if (!item.content?.url) {
    console.warn("Item has no URL, skipping");
    continue;
  }

  const prUrl = item.content.url;
  const prNumber = extractPRNumber(prUrl);

  if (!prNumber) {
    console.warn(`Could not extract PR number from URL: ${prUrl}`);
    continue;
  }

  console.log(`Processing PR #${prNumber}: ${prUrl}`);

  // Check if issue already exists
  const existingIssues = await searchTypeScriptGoIssues(`PR #${prNumber}`);

  if (existingIssues.length) {
    console.log(
      `Issue already exists for PR #${prNumber}: ${existingIssues[0].url}`
    );
    continue;
  }
  await processItemForIssue(item);
  processedCount++;
}

console.log("Issue creation process completed");

/**
 * Filter board items to find those that need issues created:
 * - Status is "Not Ported"
 * - Release is "5.8 (or earlier)"
 * - Has a PR URL
 */
function filterItemsForIssueCreation(items: BoardItem[]): BoardItem[] {
  return items.filter((item) => {
    const hasValidUrl = item.content?.url;
    const isNotPorted = item.status?.name === "Not Ported";
    const isIn58 = item.release?.name === "5.8 (or earlier)";

    return hasValidUrl && isNotPorted && isIn58;
  });
}

/**
 * Process a single board item to create an issue if one doesn't already exist
 */
async function processItemForIssue(item: BoardItem): Promise<void> {
  // Get PR details needed for issue creation
  const prUrl = item.content!.url;
  const prDetails = await getPRDetails(prUrl);

  if (!prDetails) {
    console.warn(`Could not fetch PR details for ${prUrl}`);
    return;
  }

  // Create the issue
  await createIssue(item, prDetails);
}

/**
 * Extract PR number from GitHub PR URL
 */
function extractPRNumber(prUrl: string): string | null {
  const match = prUrl.match(/\/pull\/(\d+)$/);
  return match ? match[1] : null;
}

/**
 * Get detailed information about a PR from the TypeScript repo
 */
async function getPRDetails(prUrl: string): Promise<PRDetails | null> {
  console.log(`Fetching PR details for ${prUrl}...`);

  const details = await getTypeScriptPRDetails(prUrl);

  if (!details) {
    return null;
  }

  return {
    title: details.title,
    mergeCommitSha: details.mergeCommitSha,
    body: details.body,
  };
}

/**
 * Create an issue on microsoft/typescript-go
 */
async function createIssue(
  boardItem: BoardItem,
  prDetails: PRDetails
): Promise<void> {
  if (!boardItem.content?.url) return;

  const prNumber = extractPRNumber(boardItem.content.url);
  const issueTitle = generateIssueTitle(prDetails.title, prNumber);
  const issueBody = generateIssueBody(boardItem, prDetails);
  const assignees = getIssueAssignees(boardItem);

  console.log(`${DRY_RUN ? "[DRY RUN] " : ""}Creating issue: ${issueTitle}`);
  console.log(`Assignees: ${assignees.join(", ")}`);

  if (DRY_RUN) {
    console.log("📝 Issue body preview:");
    console.log("=".repeat(50));
    console.log(issueBody);
    console.log("=".repeat(50));
    return;
  }

  const result = await createTypeScriptGoIssue(
    issueTitle,
    issueBody,
    assignees
  );

  if (result) {
    console.log(`✅ Created issue #${result.number}: ${result.url}`);
  } else {
    console.error(`❌ Failed to create issue for PR ${prNumber}`);
  }
}

/**
 * Generate a consistent title for the issue
 */
function generateIssueTitle(prTitle: string, prNumber: string | null): string {
  const prefix = "Port TypeScript PR";
  const suffix = prNumber ? `#${prNumber}` : "";
  return `${prefix} ${suffix}: ${prTitle}`;
}

/**
 * Generate the issue body with template and PR details
 */
function generateIssueBody(boardItem: BoardItem, prDetails: PRDetails): string {
  const prUrl = boardItem.content!.url;
  const mergeCommitSha = prDetails.mergeCommitSha;

  const template = `This repository is a port of microsoft/TypeScript from TypeScript to Go. Since the port began, the following pull request was applied to microsoft/TypeScript. An equivalent change now needs to be applied here.

## PR to port
- PR link: ${prUrl}
- Squash commit diff: https://github.com/microsoft/TypeScript/commit/${mergeCommitSha}.patch

## Instructions

1. Use \`playwright\` to view the PR listed above
3. Apply the edits made in that PR to this codebase, translating them from TypeScript to Go.
   - The change may or may not be applicable. It may have already been ported. Do not make any significant changes outside the scope of the diff. If the change cannot be applied without significant out-of-scope changes, explain why and stop working.
   - Tip: search for functions and identifiers from the diff to find the right location to apply edits. Some files in microsoft/TypeScript have been split into multiple.
   - Tip: some changes have already been ported, like changes to diagnostic message text. Tests do not need to be ported as they are imported from the submodule.
3. Check that the code builds by running \`npx hereby build\` in the terminal.
4. Run tests. **It is expected that tests will fail due to baseline changes.**
   - Run \`npx hereby test\` in a terminal. They should fail with messages about baseline changes.
     - Tip: to run a single baseline test from the submodule, run \`go test ./internal/testrunner -run '^TestSubmodule/NAME_OF_TEST_FILE'\`
   - Run \`npx hereby baseline-accept\` to adopt the baseline changes.
   - Run \`git diff 'testdata/**/*.diff'\`. If your change is correct, these diff files will be reduced or completely deleted.
5. Iterate until you are satisfied with your change. Commit everything, including the baseline changes in \`testdata\`, and open a PR.`;

  return template;
}

/**
 * Determine who should be assigned to the issue
 */
function getIssueAssignees(boardItem: BoardItem): string[] {
  const assignees = ["Copilot"]; // Always assign to Copilot

  // Add suggested assignee from board if available
  const suggestedAssignee = boardItem.assignee?.text;
  if (suggestedAssignee && suggestedAssignee.trim()) {
    assignees.push(suggestedAssignee.trim());
  }

  return assignees;
}

// Type definitions for this module
interface PRDetails {
  title: string;
  mergeCommitSha: string;
  body: string;
}
