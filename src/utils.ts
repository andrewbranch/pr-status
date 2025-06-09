import type { MergedPR, Status } from "./types.ts";

const teamMembers = new Set([
  "sandersn",
  "DanielRosenwasser",
  "weswigham",
  "andrewbranch",
  "ahejlsberg",
  "jakebailey",
  "RyanCavanaugh",
  "gabritto",
  "iisaduan",
  "navya9singh",
  "sheetalkamat",
]);

const buildAndWatchPaths = new Set([
  "src/compiler/builder.ts",
  "src/compiler/builderPublic.ts",
  "src/compiler/builderState.ts",
  "src/compiler/watch.ts",
  "src/compiler/tsbuild.ts",
  "src/compiler/tsbuildPublic.ts",
  "src/compiler/watch.ts",
  "src/compiler/watchPublic.ts",
  "src/compiler/watchUtilities.ts",
]);

const ignoredCompilerPaths = new Set([
  "src/compiler/performance.ts",
  "src/compiler/performanceCore.ts",
  "src/compiler/resolutionCache.ts",
  "src/compiler/tracing.ts",
  "src/compiler/types.ts",
]);

export function getStatus(pr: MergedPR): Status {
  if (hasRelevantPath(pr)) {
    return "Not Ported";
  }
  if (hasLSPath(pr)) {
    return "N/A (LS)";
  }
  if (hasBuildOrWatchPath(pr)) {
    return "N/A (Build/Watch)";
  }
  return "N/A (No Need)";
}

export function hasRelevantPath(pr: MergedPR): boolean {
  return pr.files.nodes.some(
    (file) =>
      (file.path.startsWith("src/compiler/") &&
        !ignoredCompilerPaths.has(file.path) &&
        !buildAndWatchPaths.has(file.path)) ||
      file.path.startsWith("src/lib/") ||
      file.path.startsWith("src/tsc/")
  );
}

export function hasLSPath(pr: MergedPR): boolean {
  return pr.files.nodes.some(
    (file) =>
      file.path.startsWith("src/services/") ||
      file.path.startsWith("src/tsserver/") ||
      file.path.startsWith("src/typingsInstaller/") ||
      file.path.startsWith("src/typingsInstallerCore/")
  );
}

export function hasBuildOrWatchPath(pr: MergedPR): boolean {
  return pr.files.nodes.some((file) => buildAndWatchPaths.has(file.path));
}

export function getAssignee(pr: MergedPR): string | undefined {
  if (teamMembers.has(pr.author.login)) {
    return pr.author.login;
  }
  const assignee = pr.assignees.nodes.find((assignee) =>
    teamMembers.has(assignee.login)
  );
  if (assignee) {
    return assignee.login;
  }
  const approvingReviewer = pr.reviews.nodes.find(
    (review) =>
      review.state === "APPROVED" && teamMembers.has(review.author.login)
  )?.author.login;
  if (approvingReviewer) {
    return approvingReviewer;
  }
  const reviewer = pr.reviews.nodes.find((review) =>
    teamMembers.has(review.author.login)
  )?.author.login;
  if (reviewer) {
    return reviewer;
  }
}
