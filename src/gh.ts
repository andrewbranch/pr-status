import { graphql } from "@octokit/graphql";
import { promises as fs } from "fs";
import type {
  ProjectQueryResponse,
  MergedPRsQueryResponse,
  FilePaginationQueryResponse,
  MergedPR,
  Status,
  Release,
  BoardItem,
} from "./types.ts";

if (!process.env.GITHUB_TOKEN) {
  // Scopes: ["repo", "project", "read:org", "read:user"]
  throw new Error("GITHUB_TOKEN environment variable is required");
}

const request = graphql.defaults({
  headers: {
    authorization: `token ${process.env.GITHUB_TOKEN}`,
  },
});

const cacheFile = "./pr_cache.json";
const version = 3;
const startDate = "2024-09-26T00:00:00Z";

const projectNumber = 1588;
const projectId = "PVT_kwDOAF3p4s4Av_GA";
const assigneesFieldId = "PVTF_lADOAF3p4s4Av_GAzgmgoeA";
const statusFieldId = "PVTSSF_lADOAF3p4s4Av_GAzgmU7n8";
const statusOptionIds = new Map<Status, string>([
  ["Not Ported", "86139f13"],
  ["Ported", "6d64e456"],
  ["N/A (LS)", "fafd778c"],
  ["N/A (Build/Watch)", "b0652e81"],
  ["N/A (No Need)", "532f8030"],
]);
const releaseFieldId = "PVTSSF_lADOAF3p4s4Av_GAzgve4ow";
const releaseOptionIds = new Map<Release, string>([
  ["5.8 (or earlier)", "955a53a2"],
  ["5.9", "cf015096"],
]);
const typescriptGoRepoId = "R_kgDOM0QWIw";
const portingPRLabelId = "LA_kwDOM0QWI88AAAACCeGIEQ";

// Release tags to check, ordered from oldest to newest
const releaseTags = [
  { name: "v5.8.3", release: "5.8 (or earlier)" as const },
] as const;
export async function getBoard() {
  const query = `
    query($org: String!, $projectNumber: Int!, $cursor: String) {
      organization(login: $org) {
        projectV2(number: $projectNumber) {
          items(first: 100, after: $cursor) {
            nodes {
              id
              content {
                ... on PullRequest {
                  url
                }
              }
              assignee: fieldValueByName(name: "Suggested Assignee") {
                ... on ProjectV2ItemFieldTextValue {
                  text
                }
              }
              status: fieldValueByName(name: "Status") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  id
                  name
                }
              }
              release: fieldValueByName(name: "Release") {
                ... on ProjectV2ItemFieldSingleSelectValue {
                  id
                  name
                }
              }
            }
            pageInfo {
              endCursor
              hasNextPage
            }
          }
        }
      }
    }
  `;
  let hasNextPage = true;
  let cursor: string | undefined;
  const allItems = [];

  while (hasNextPage) {
    const data = await request<ProjectQueryResponse>(query, {
      org: "microsoft",
      projectNumber,
      cursor,
    });
    const { nodes, pageInfo } = data.organization.projectV2.items;
    allItems.push(...nodes);
    cursor = pageInfo.endCursor;
    hasNextPage = pageInfo.hasNextPage;
  }

  return { items: { nodes: allItems } };
}

export async function getMergedPRs(): Promise<MergedPR[]> {
  let since = startDate;
  let cachedData: { version: number; timestamp: string; prs: MergedPR[] } = {
    version: 0,
    timestamp: "",
    prs: [],
  };

  try {
    const cacheContent = JSON.parse(await fs.readFile(cacheFile, "utf-8"));
    if (cacheContent.version === version) {
      cachedData = cacheContent;
      since = cachedData.timestamp;
    }
  } catch {}

  const query = `
    query($repo: String!, $owner: String!, $cursor: String) {
      repository(name: $repo, owner: $owner) {
        pullRequests(states: MERGED, first: 100, orderBy: {field: UPDATED_AT, direction: DESC}, after: $cursor) {
          nodes {
            id
            title
            url
            mergedAt
            updatedAt
            baseRefName
            mergeCommit {
              oid
            }
            author {
              login
            }
            assignees(first: 10) {
              nodes {
                login
              }
            }
            reviews(first: 10) {
              nodes {
                state
                author {
                  login
                }
              }
            }
          }
          pageInfo {
            endCursor
            hasNextPage
          }
        }
      }
    }
  `;
  let hasNextPage = true;
  let cursor: string | undefined;
  const prs = cachedData.prs;
  const cachedPRs = new Set(prs.map((pr) => pr.url));

  outer: while (hasNextPage) {
    const data = await request<MergedPRsQueryResponse>(query, {
      owner: "microsoft",
      repo: "TypeScript",
      cursor,
    });
    const { nodes, pageInfo } = data.repository.pullRequests;

    for (const pr of nodes) {
      if (new Date(pr.updatedAt) < new Date(since)) {
        // We've reached the last PR we've seen before
        break outer;
      }
      if (
        new Date(pr.mergedAt) < new Date(since) ||
        cachedPRs.has(pr.url) ||
        pr.baseRefName !== "main"
      ) {
        continue;
      }

      let fileCursor: string | undefined;
      // Re-fetch files if there might be more because
      // The GraphQL server keeps falling over when I try
      // to do this properly with a cursor in the initial query
      let hasMoreFiles = true;
      pr.files = { nodes: [] };

      while (hasMoreFiles) {
        const fileData = await request<FilePaginationQueryResponse>(
          `
            query($repo: String!, $owner: String!, $prNumber: Int!, $fileCursor: String) {
              repository(name: $repo, owner: $owner) {
                pullRequest(number: $prNumber) {
                  files(first: 100, after: $fileCursor) {
                    nodes {
                      path
                    }
                    pageInfo {
                      endCursor
                      hasNextPage
                    }
                  }
                }
              }
            }
          `,
          {
            owner: "microsoft",
            repo: "TypeScript",
            prNumber: parseInt(pr.url.split("/").pop() || "0"),
            fileCursor,
          }
        );

        const { files } = fileData.repository.pullRequest;
        pr.files.nodes.push(...files.nodes);
        fileCursor = files.pageInfo.endCursor;
        hasMoreFiles = files.pageInfo.hasNextPage;
      }

      prs.push(pr);
    }
    cursor = pageInfo.endCursor;
    hasNextPage = pageInfo.hasNextPage;
  }

  prs.sort(
    (a, b) => new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime()
  );

  cachedData = {
    version,
    timestamp: new Date().toISOString(),
    prs,
  };

  await fs.writeFile(cacheFile, JSON.stringify(cachedData, null, 2));
  return prs;
}

export async function addOrUpdateCard(
  existing: BoardItem | undefined,
  pr: MergedPR,
  assignee: string | undefined,
  status: Status,
  release: Release | undefined
) {
  const addCardMutation = `
    mutation($projectId: ID!, $contentId: ID!) {
      addProjectV2ItemById(input: {projectId: $projectId, contentId: $contentId}) {
        item {
          id
        }
      }
    }
  `;
  const setAssigneeMutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value}) {
        projectV2Item {
          id
        }
      }
    }
  `;
  const setStatusMutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value}) {
        projectV2Item {
          id
        }
      }
    }
  `;
  const setReleaseMutation = `
    mutation($projectId: ID!, $itemId: ID!, $fieldId: ID!, $value: ProjectV2FieldValue!) {
      updateProjectV2ItemFieldValue(input: {projectId: $projectId, itemId: $itemId, fieldId: $fieldId, value: $value}) {
        projectV2Item {
          id
        }
      }
    }
  `;

  let itemId = existing?.id;
  if (!existing) {
    console.log(
      `Adding new card for PR #${pr.url.slice(pr.url.lastIndexOf("/") + 1)}: `,
      pr.title
    );
    const addCardData = await request<{
      addProjectV2ItemById: { item: { id: string } };
    }>(addCardMutation, {
      projectId,
      contentId: pr.id,
    });
    itemId = addCardData.addProjectV2ItemById.item.id;
  } else {
    console.log(
      `Updating existing card for PR #${pr.url.slice(
        pr.url.lastIndexOf("/") + 1
      )}: `,
      pr.title
    );
  }

  if (assignee !== existing?.assignee?.text) {
    console.log("Setting assignee: ", assignee);
    await request(setAssigneeMutation, {
      projectId,
      itemId,
      fieldId: assigneesFieldId,
      value: { text: assignee ?? "" },
    });
  }

  // Only set status for new additions
  if (!existing) {
    const statusId = statusOptionIds.get(status);
    await request(setStatusMutation, {
      projectId,
      itemId,
      fieldId: statusFieldId,
      value: { singleSelectOptionId: statusId },
    });
  }

  // Only set release field if release is defined
  if (release !== undefined) {
    console.log("Setting release: ", release);
    const releaseId = releaseOptionIds.get(release);
    await request(setReleaseMutation, {
      projectId,
      itemId,
      fieldId: releaseFieldId,
      value: { singleSelectOptionId: releaseId },
    });
  }

  return itemId;
}

export async function determineTypeScriptRelease(
  commitSha: string
): Promise<Release | undefined> {
  // Check against each release tag from oldest to newest
  for (const tag of releaseTags) {
    try {
      const query = `
        query($owner: String!, $repo: String!, $mergeCommitId: String!) {
          repository(owner: $owner, name: $repo) {
            ref(qualifiedName: "refs/tags/${tag.name}") {
              compare(headRef: $mergeCommitId) {
                status
              }
            }
          }
        }
      `;

      const data = await request<{
        repository: {
          ref: {
            compare: {
              status: string;
            };
          } | null;
        };
      }>(query, {
        owner: "microsoft",
        repo: "TypeScript",
        mergeCommitId: commitSha,
      });

      // If the ref exists and the commit is behind or identical, it belongs to this release
      if (
        data.repository.ref?.compare.status === "BEHIND" ||
        data.repository.ref?.compare.status === "IDENTICAL"
      ) {
        return tag.release;
      }
    } catch (error) {
      console.warn(
        `Could not check release ${tag.name} for commit ${commitSha}:`,
        error
      );
      continue;
    }
  }

  // If commit doesn't belong to any checked tag, return undefined
  return undefined;
}

/**
 * Search for existing issues on microsoft/typescript-go that mention a specific PR number
 */
export async function searchTypeScriptGoIssues(
  searchTitle: string
): Promise<{ url: string }[]> {
  const query = `
    query {
      search(type: ISSUE, query: "repo:microsoft/typescript-go is:issue label:\\"Porting PR\\" ${searchTitle} in:title", first:100) {
        nodes {
          ...on Issue {
            url
          }
        }
      }
    }`;

  const data = await request<{
    search: {
      nodes: {
        url: string;
      }[];
    };
  }>(query);

  return data.search.nodes.map((issue) => ({
    url: issue.url,
    number: issue.url,
  }));
}

/**
 * Get detailed information about a TypeScript PR
 */
export async function getTypeScriptPRDetails(prUrl: string): Promise<{
  title: string;
  mergeCommitSha: string;
  body: string;
  number: number;
} | null> {
  const prNumber = prUrl.split("/").pop();
  if (!prNumber) return null;

  const query = `
    query($owner: String!, $repo: String!, $prNumber: Int!) {
      repository(owner: $owner, name: $repo) {
        pullRequest(number: $prNumber) {
          title
          body
          number
          mergeCommit {
            oid
          }
        }
      }
    }
  `;

  try {
    const data = await request<{
      repository: {
        pullRequest: {
          title: string;
          body: string;
          number: number;
          mergeCommit: {
            oid: string;
          };
        };
      };
    }>(query, {
      owner: "microsoft",
      repo: "TypeScript",
      prNumber: parseInt(prNumber),
    });

    const pr = data.repository.pullRequest;
    return {
      title: pr.title,
      body: pr.body || "",
      number: pr.number,
      mergeCommitSha: pr.mergeCommit.oid,
    };
  } catch (error) {
    console.warn(`Error fetching PR details for ${prUrl}:`, error);
    return null;
  }
}

/**
 * Create an issue on microsoft/typescript-go
 */
export async function createTypeScriptGoIssue(
  title: string,
  body: string,
  assignees: string[]
): Promise<{ url: string; number: number } | null> {
  const mutation = `
    mutation($repositoryId: ID!, $title: String!, $body: String!, $assigneeIds: [ID!], $labelIds: [ID!]) {
      createIssue(input: {
        repositoryId: $repositoryId
        title: $title
        body: $body
        assigneeIds: $assigneeIds
        labelIds: $labelIds
      }) {
        issue {
          number
          url
        }
      }
    }
  `;

  // Get user IDs for assignees
  const assigneeIds: string[] = [];
  for (const assignee of assignees) {
    const userId = await getUserId(assignee);
    if (userId) {
      assigneeIds.push(userId);
    }
  }

  const data = await request<{
    createIssue: {
      issue: {
        number: number;
        url: string;
      };
    };
  }>(mutation, {
    repositoryId: typescriptGoRepoId,
    title,
    body,
    assigneeIds,
    labelIds: [portingPRLabelId],
  });

  return {
    url: data.createIssue.issue.url,
    number: data.createIssue.issue.number,
  };
}

// Cache for user IDs to avoid repeated API calls
const userIdCache = new Map<string, string>([
  ["copilot", "BOT_kgDOC9w8XQ"], // Pre-populate known bot ID
]);

/**
 * Get a GitHub user's ID by their login
 */
export async function getUserId(login: string): Promise<string | null> {
  const normalizedLogin = login.toLowerCase();

  // Check cache first
  if (userIdCache.has(normalizedLogin)) {
    return userIdCache.get(normalizedLogin)!;
  }

  try {
    const userQuery = `
      query($login: String!) {
        user(login: $login) {
          id
        }
      }
    `;
    const userData = await request<{
      user: { id: string };
    }>(userQuery, { login });

    const userId = userData.user.id;
    // Cache the result
    userIdCache.set(normalizedLogin, userId);
    return userId;
  } catch (error) {
    console.warn(`Could not find user ID for user ${login}:`, error);
    return null;
  }
}
