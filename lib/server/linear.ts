// Comentarios de usuarios guardados como issues de Linear (proyecto "leadta"). Linear es el registro: no hay colección propia.
const linearUrl = "https://api.linear.app/graphql";
// ponytail: IDs fijos del workspace (equipo TOM, proyecto leadta); si se mueve el proyecto, actualizar acá.
const teamId = "f2c38c9f-cc6e-4eb4-8829-a9463e47a833";
const projectId = "b5fc1737-3822-42de-9280-89dafdd50089";
const todoStateId = "2d0f536b-b13d-4fab-bf4f-5125cfa5c1c9";
const doneStateId = "5ae1b02a-4edd-4be7-8666-81b07269a327";
const labelIds = { bug: "4a9c77ac-1c97-4712-bd81-f75cd75b220e", comment: "0515c1f5-bd04-4426-bf77-1b31fe825d78" } as const;
// Marcador al final de la descripción: identifica los issues de comentarios y guarda a quién agradecer.
const markerPrefix = "leadta-feedback-user:";
// ponytail: el panel lee los últimos 100 comentarios; paginar con cursor de Linear si llegan a ser más.
const listLimit = 100;

export type FeedbackKind = keyof typeof labelIds;
export type FeedbackIssue = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  state: "open" | "closed";
  kind: FeedbackKind;
  message: string;
  user: { id: string; email: string; locale: "es" | "en" } | null;
};

type IssueNode = {
  id: string;
  identifier: string;
  title: string;
  url: string;
  createdAt: string;
  description?: string | null;
  state: { type: string };
  labels: { nodes: { id: string }[] };
  project?: { id: string } | null;
};

const issueFields = "id identifier title url createdAt description state { type } labels { nodes { id } } project { id }";

export function isLinearConfigured() {
  return Boolean(process.env.LINEAR_API_KEY?.trim());
}

async function linear<T>(query: string, variables: Record<string, unknown>): Promise<T> {
  const apiKey = process.env.LINEAR_API_KEY?.trim();
  if (!apiKey) throw new Error("LINEAR_API_KEY is not configured.");
  const response = await fetch(linearUrl, {
    method: "POST",
    headers: { Authorization: apiKey, "Content-Type": "application/json" },
    body: JSON.stringify({ query, variables }),
    cache: "no-store",
    signal: AbortSignal.timeout(10_000),
  });
  const payload = await response.json().catch(() => null) as { data?: T; errors?: { message?: string }[] } | null;
  if (!response.ok || !payload?.data || payload.errors?.length) {
    throw new Error(`Linear responded ${response.status}: ${payload?.errors?.[0]?.message?.slice(0, 160) ?? "no data"}`);
  }
  return payload.data;
}

function markerLine(user: { id: string; email: string; locale: string }) {
  // En code span para que Linear no convierta el email en link.
  return `\`${markerPrefix} ${user.id} ${user.email} ${user.locale}\``;
}

function parseMarker(description: string): FeedbackIssue["user"] {
  const line = description.split("\n").reverse().find((item) => item.includes(markerPrefix));
  const rest = line?.slice(line.indexOf(markerPrefix) + markerPrefix.length).replace(/`/g, " ") ?? "";
  const id = rest.trim().split(/\s+/)[0];
  // Tolera que Linear haya convertido el email en [mail](<mailto:mail>).
  const email = rest.match(/[^\s<>()[\]`:]+@[^\s<>()[\]`]+\.[a-z]{2,}/i)?.[0];
  if (!id || !/^[a-zA-Z0-9]{8,32}$/.test(id) || !email) return null;
  return { id, email: email.toLowerCase(), locale: /\sen\s*$/.test(rest) ? "en" : "es" };
}

/** Texto que escribió el usuario: la descripción guarda el mensaje como cita bajo "## Mensaje". */
function extractMessage(description: string) {
  const section = description.split("## Mensaje")[1]?.split("\n## ")[0] ?? "";
  return section.split("\n").map((line) => line.replace(/^>\s?/, "")).join("\n").trim();
}

function toFeedbackIssue(node: IssueNode): FeedbackIssue {
  const description = node.description ?? "";
  return {
    id: node.id,
    identifier: node.identifier,
    title: node.title,
    url: node.url,
    createdAt: node.createdAt,
    state: ["completed", "canceled", "duplicate"].includes(node.state.type) ? "closed" : "open",
    kind: node.labels.nodes.some((label) => label.id === labelIds.bug) ? "bug" : "comment",
    message: extractMessage(description),
    user: parseMarker(description),
  };
}

export async function createFeedbackIssue(input: {
  kind: FeedbackKind;
  title: string;
  description: string;
  user: { id: string; email: string; locale: string };
}) {
  const data = await linear<{ issueCreate: { success: boolean; issue: { id: string; identifier: string; url: string } } }>(
    `mutation($input: IssueCreateInput!) { issueCreate(input: $input) { success issue { id identifier url } } }`,
    {
      input: {
        teamId,
        projectId,
        stateId: todoStateId,
        labelIds: [labelIds[input.kind]],
        title: input.title,
        description: `${input.description}\n\n---\n${markerLine(input.user)}`,
      },
    },
  );
  if (!data.issueCreate.success) throw new Error("Linear did not create the issue.");
  return data.issueCreate.issue;
}

export async function listFeedbackIssues() {
  const data = await linear<{ issues: { nodes: IssueNode[] } }>(
    `query($projectId: ID!, $first: Int!) {
      issues(first: $first, orderBy: createdAt, filter: { project: { id: { eq: $projectId } }, description: { contains: "${markerPrefix}" } }) { nodes { ${issueFields} } }
    }`,
    { projectId, first: listLimit },
  );
  return data.issues.nodes.map(toFeedbackIssue).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Devuelve el comentario solo si el issue es del proyecto y tiene el marcador; si no, null. */
export async function getFeedbackIssue(id: string) {
  const data = await linear<{ issue: IssueNode | null }>(`query($id: String!) { issue(id: $id) { ${issueFields} } }`, { id });
  const node = data.issue;
  if (!node || node.project?.id !== projectId || !node.description?.includes(markerPrefix)) return null;
  return toFeedbackIssue(node);
}

export async function setFeedbackIssueState(id: string, state: "open" | "closed") {
  await linear(`mutation($id: String!, $stateId: String!) { issueUpdate(id: $id, input: { stateId: $stateId }) { success } }`, {
    id,
    stateId: state === "closed" ? doneStateId : todoStateId,
  });
}
