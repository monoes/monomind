/**
 * Publishes a map of filename→content to GitHub Gist.
 * files: Record<filename, markdown content>
 */
export async function publishToGist(files, config) {
    const url = config.gistId
        ? `https://api.github.com/gists/${config.gistId}`
        : 'https://api.github.com/gists';
    const method = config.gistId ? 'PATCH' : 'POST';
    const gistFiles = {};
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
    let response;
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
    }
    finally {
        clearTimeout(timer);
    }
    if (!response.ok) {
        throw new Error(`Gist publish failed: ${response.status} ${response.statusText}`);
    }
    const data = (await response.json());
    return {
        gistId: data.id,
        url: data.html_url,
        filesPublished: Object.keys(data.files).length,
    };
}
//# sourceMappingURL=gist-publisher.js.map