declare const browseCommand: {
    subcommands: import("../types.js").Command[];
    name: string;
    description: string;
    aliases?: string[];
    options?: import("@monoes/monobrowse/cli/types").CommandOption[];
    examples?: import("@monoes/monobrowse/cli/types").CommandExample[];
    action?: import("@monoes/monobrowse/cli/types").CommandAction;
    hidden?: boolean;
};
export default browseCommand;
//# sourceMappingURL=browse.d.ts.map