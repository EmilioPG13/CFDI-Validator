// GitHub write path: branch -> blob(s) -> tree -> commit -> ref update -> PR, via the
// raw REST API with no SDK dependency. The low-level flow (rather than the per-file
// Contents API) is required, not preferred: the watcher commits a ~25 MB binary
// (catalogs.db.bz2), and the Contents API rejects uploads over 1 MB while the Blobs
// API accepts up to 100 MB.

export interface GhClient {
  repo: string; // "owner/name"
  token: string;
}

function headers(token: string): Record<string, string> {
  return {
    authorization: `Bearer ${token}`,
    "content-type": "application/json",
    accept: "application/vnd.github+json",
    // POST/PUT/PATCH also need a user-agent on GitHub's API; missing one is a 403.
    "user-agent": "cfdi-risk-auditor/catalog-watcher",
  };
}

async function ghSend<T>(
  gh: GhClient,
  method: "GET" | "POST" | "PUT" | "PATCH",
  path: string,
  body?: unknown,
): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    method,
    headers: headers(gh.token),
    signal: AbortSignal.timeout(120_000),
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub ${method} ${path} failed: HTTP ${res.status} -- ${text.slice(0, 500)}`);
  }
  return (text ? JSON.parse(text) : null) as T;
}

export async function getBranchSha(gh: GhClient, branch: string): Promise<string> {
  const ref = await ghSend<{ object: { sha: string } }>(gh, "GET", `/repos/${gh.repo}/git/ref/heads/${branch}`);
  return ref.object.sha;
}

export async function branchExists(gh: GhClient, branch: string): Promise<boolean> {
  try {
    await getBranchSha(gh, branch);
    return true;
  } catch {
    return false;
  }
}

export async function createBranch(gh: GhClient, branch: string, fromBranch = "main"): Promise<void> {
  const sha = await getBranchSha(gh, fromBranch);
  await ghSend(gh, "POST", `/repos/${gh.repo}/git/refs`, { ref: `refs/heads/${branch}`, sha });
}

/** One blob per file; base64 body so binaries ride along without a text round-trip. */
export async function createBlob(gh: GhClient, content: Uint8Array): Promise<string> {
  const b64 = Buffer.from(content).toString("base64");
  const res = await ghSend<{ sha: string }>(gh, "POST", `/repos/${gh.repo}/git/blobs`, {
    content: b64,
    encoding: "base64",
  });
  return res.sha;
}

export interface TreeEntry {
  path: string;
  blobSha: string;
}

export async function createTree(
  gh: GhClient,
  baseCommitSha: string,
  entries: TreeEntry[],
): Promise<string> {
  const commit = await ghSend<{ tree: { sha: string } }>(gh, "GET", `/repos/${gh.repo}/git/commits/${baseCommitSha}`);
  const tree = await ghSend<{ sha: string }>(gh, "POST", `/repos/${gh.repo}/git/trees`, {
    base_tree: commit.tree.sha,
    tree: entries.map((e) => ({ path: e.path, mode: "100644", type: "blob", sha: e.blobSha })),
  });
  return tree.sha;
}

export async function createCommit(
  gh: GhClient,
  message: string,
  treeSha: string,
  parentSha: string,
): Promise<string> {
  const commit = await ghSend<{ sha: string }>(gh, "POST", `/repos/${gh.repo}/git/commits`, {
    message,
    tree: treeSha,
    parents: [parentSha],
  });
  return commit.sha;
}

export async function updateBranch(gh: GhClient, branch: string, commitSha: string): Promise<void> {
  await ghSend(gh, "PATCH", `/repos/${gh.repo}/git/refs/heads/${branch}`, { sha: commitSha, force: false });
}

export interface CreatedPull {
  number: number;
  htmlUrl: string;
}

export async function createPullRequest(
  gh: GhClient,
  args: { head: string; base: string; title: string; body: string },
): Promise<CreatedPull> {
  const pr = await ghSend<{ number: number; html_url: string }>(gh, "POST", `/repos/${gh.repo}/pulls`, {
    head: args.head,
    base: args.base,
    title: args.title,
    body: args.body,
  });
  return { number: pr.number, htmlUrl: pr.html_url };
}
