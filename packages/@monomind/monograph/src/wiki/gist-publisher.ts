export interface GistPublishConfig {
  token: string;
  gistId?: string;
  description?: string;
  public?: boolean;
}

export interface GistPublishResult {
  gistId: string;
  url: string;
  filesPublished: number;
}

interface GistApiResponse {
  id: string;
  html_url: string;
  files: Record<string, unknown>;
}

/**
 * Publishes a map of filename→content to GitHub Gist.
 * files: Record<filename, markdown content>
 */
export async function publishToGist(
  files: Record<string, string>,
  config: GistPublishConfig,
): Promise<GistPublishResult> {
  const url = config.gistId
    ? `https://api.github.com/gists/${config.gistId}`
    : 'https://api.github.com/gists';

  const method = config.gistId ? 'PATCH' : 'POST';

  const gistFiles: Record<string, { content: string }> = {};
  for (const [filename, content] of Object.entries(files)) {
    gistFiles[filename] = { content };
  }

  const body = {
    description: config.description ?? 'Monograph wiki',
    public: config.public ?? false,
    files: gistFiles,
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 30_000);

  let response: Response;
  try {
    response = await fetch(url, {
      method,
      headers: {
        'Authorization': `Bearer ${config.token}`,
        'Content-Type': 'application/json',
        'Accept': 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  if (!response.ok) {
    throw new Error(`Gist publish failed: ${response.status} ${response.statusText}`);
  }

  const data = (await response.json()) as GistApiResponse;

  return {
    gistId: data.id,
    url: data.html_url,
    filesPublished: Object.keys(data.files).length,
  };
}
