/**
 * Build an LLM prompt for generating a wiki page about a code community.
 */
export function buildWikiPrompt(context) {
    const symbolLines = context.topSymbols
        .map(s => `  - [${s.label}] ${s.name}${s.filePath ? ` (${s.filePath})` : ''}`)
        .join('\n');
    return `You are a technical documentation writer. Write a concise markdown wiki page for the following code module (community).

Community ID: ${context.communityId}
Module Name: ${context.label}
Incoming Dependencies: ${context.incomingCount} (other modules that depend on this one)
Outgoing Dependencies: ${context.outgoingCount} (modules this one depends on)

Top Symbols:
${symbolLines || '  (none)'}

Write a wiki page that includes:
1. A brief description of what this module does
2. The key entry points and their purpose
3. What this module depends on and what depends on it
4. Any notable architectural patterns observed

Format the output as markdown with a top-level heading using the module name.
Be concise but informative. Focus on the role this module plays in the overall system.`;
}
//# sourceMappingURL=prompt-builder.js.map