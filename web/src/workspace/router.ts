// Workspace routes (hash based, so Firebase Hosting needs no rewrites):
//   #/                                  the workspace, no project open
//   #/projects/{projectId}              a project page: its chats and its site report
//   #/projects/{projectId}/chats/{id}   a chat with its artifact canvas
//   #/projects/{projectId}/chats/{id}/artifacts/{artifactId}   that chat with one artifact open
//   #/projects/{projectId}/documents    the project's documents: uploads and artifacts
export interface WorkspaceRoute {
  projectId: string | null;
  chatId: string | null;
  /** The artifact to open in the chat's canvas (otherwise its latest). */
  artifactId?: string | null;
  /** A page of the project other than its overview. */
  page?: "documents";
}

export interface Router {
  current(): WorkspaceRoute;
  go(route: WorkspaceRoute): void;
  /** Calls back when the route changes (back and forward buttons, links). Returns the unsubscribe. */
  subscribe(onChange: (route: WorkspaceRoute) => void): () => void;
}

export function parseRoute(hash: string): WorkspaceRoute {
  const m = hash.match(/^#\/projects\/([^/?#]+)(?:\/(documents)|\/chats\/([^/?#]+)(?:\/artifacts\/([^/?#]+))?)?/);
  if (!m) return { projectId: null, chatId: null };
  const route: WorkspaceRoute = { projectId: decodeURIComponent(m[1]!), chatId: m[3] ? decodeURIComponent(m[3]) : null };
  if (m[2]) route.page = "documents";
  if (m[4]) route.artifactId = decodeURIComponent(m[4]);
  return route;
}

export function routeHref({ projectId, chatId, artifactId, page }: WorkspaceRoute): string {
  if (!projectId) return "#/";
  const project = `#/projects/${encodeURIComponent(projectId)}`;
  if (chatId) {
    const chat = `${project}/chats/${encodeURIComponent(chatId)}`;
    return artifactId ? `${chat}/artifacts/${encodeURIComponent(artifactId)}` : chat;
  }
  return page === "documents" ? `${project}/documents` : project;
}

/** The browser's address bar: every project and chat has its own link, and back/forward work. */
export function hashRouter(win: Window = window): Router {
  return {
    current: () => parseRoute(win.location.hash),
    go: (route) => {
      const href = routeHref(route);
      if (win.location.hash !== href) win.location.hash = href;
    },
    subscribe: (onChange) => {
      const listener = () => onChange(parseRoute(win.location.hash));
      win.addEventListener("hashchange", listener);
      return () => win.removeEventListener("hashchange", listener);
    },
  };
}

/** A router of its own (tests render two team members' workspaces in one page). */
export function memoryRouter(start: WorkspaceRoute = { projectId: null, chatId: null }): Router {
  let route = start;
  const listeners = new Set<(r: WorkspaceRoute) => void>();
  return {
    current: () => route,
    go: (next) => {
      route = next;
      for (const l of listeners) l(route);
    },
    subscribe: (onChange) => {
      listeners.add(onChange);
      return () => listeners.delete(onChange);
    },
  };
}
