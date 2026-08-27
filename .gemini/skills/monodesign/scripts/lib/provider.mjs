// Source scripts default to slash commands. The provider build replaces only
// this exact declaration, avoiding heuristic rewrites across executable code.
export const MONODESIGN_COMMAND_PREFIX = '/'; // @monodesign-provider-command-prefix
export const MONODESIGN_COMMAND = `${MONODESIGN_COMMAND_PREFIX}monodesign`;
