/** What Iknos reads of a Spira issue (IKN-96) — the REST API's `IssueDetailDto`, narrowed. */
export type SpiraIssue = {
  identifier: string;
  state: { name: string } | null;
};

/** A new issue as `POST /api/issues` takes it. */
export type SpiraIssueDraft = {
  projectKey: string;
  title: string;
  description: string;
};

/** Where Spira is and the token to reach it with. */
export type SpiraConfig = {
  url: string;
  token: string;
};
