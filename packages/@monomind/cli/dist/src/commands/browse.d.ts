declare const browseCommand: {
    name: string;
    description: string;
    aliases?: string[];
    options?: import("@monoes/monobrowse/cli/types").CommandOption[];
    examples?: import("@monoes/monobrowse/cli/types").CommandExample[];
    action?: import("@monoes/monobrowse/cli/types").CommandAction;
    hidden?: boolean;
    subcommands: import("../types.js").Command[];
};
export default browseCommand;
//# sourceMappingURL=browse.d.ts.map