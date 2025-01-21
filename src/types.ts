export interface ProjectQueryResponse {
  organization: {
    projectV2: {
      items: {
        nodes: {
          content: {
            url: string;
          } | null;
          assignee: {
            text: string;
          } | null;
          status: {
            id: string;
            name: string;
          };
        }[];
        pageInfo: {
          endCursor: string;
          hasNextPage: boolean;
        };
      };
    };
  };
}

export type Status =
  | "Not Ported"
  | "Ported"
  | "N/A (LS)"
  | "N/A (Build/Watch)"
  | "N/A (No Need)";

export interface MergedPR {
  id: string;
  title: string;
  url: string;
  mergedAt: string;
  updatedAt: string;
  baseRefName: string;
  files: {
    nodes: {
      path: string;
    }[];
    pageInfo?: {
      endCursor: string;
      hasNextPage: boolean;
    };
  };
  body: string;
  author: {
    login: string;
  };
  assignees: {
    nodes: {
      login: string;
    }[];
  };
  reviews: {
    nodes: {
      state:
        | "APPROVED"
        | "CHANGES_REQUESTED"
        | "COMMENTED"
        | "DISMISSED"
        | "PENDING";
      author: {
        login: string;
      };
    }[];
  };
}

export interface MergedPRsQueryResponse {
  repository: {
    pullRequests: {
      nodes: MergedPR[];
      pageInfo: {
        endCursor: string;
        hasNextPage: boolean;
      };
    };
  };
}

export interface FilePaginationQueryResponse {
  repository: {
    pullRequest: {
      files: {
        nodes: {
          path: string;
        }[];
        pageInfo: {
          endCursor: string;
          hasNextPage: boolean;
        };
      };
    };
  };
}
