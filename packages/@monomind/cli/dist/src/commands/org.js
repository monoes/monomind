import { output } from '../output.js';
import { existsSync, unlinkSync, rmSync, readdirSync } from 'fs';
import { join, resolve } from 'path';
const orgCommand = {
    name: 'org',
    description: 'Manage monomind organisations',
    examples: [
        { command: 'monomind org list', description: 'List all orgs in the project' },
        { command: 'monomind org delete my-org', description: 'Delete an org (with confirmation)' },
        { command: 'monomind org delete my-org --yes', description: 'Delete without confirmation' },
    ],
    action: async (context) => {
        const args = context.args ?? [];
        const sub = args[0];
        if (!sub || sub === 'help') {
            output.info('Usage: monomind org <subcommand>');
            output.info('');
            output.info('Subcommands:');
            output.info('  list              List all orgs in the current project');
            output.info('  delete <name>     Delete an org and all its data');
            return { success: true };
        }
        if (sub === 'list') {
            const cwd = context.cwd || process.cwd();
            const orgsDir = join(cwd, '.monomind', 'orgs');
            if (!existsSync(orgsDir)) {
                output.info('No orgs directory found. Create an org first with /mastermind:createorg');
                return { success: true };
            }
            const configs = readdirSync(orgsDir)
                .filter(f => f.endsWith('.json') && !f.includes('-state') && !f.includes('-goals')
                && !f.includes('-threads') && !f.includes('-activity') && !f.includes('-approvals')
                && !f.includes('-members') && !f.includes('-secrets') && !f.includes('-budgets'));
            if (!configs.length) {
                output.info('No orgs found.');
                return { success: true };
            }
            output.info(`Found ${configs.length} org(s):`);
            for (const f of configs)
                output.info(`  • ${f.replace('.json', '')}`);
            return { success: true };
        }
        if (sub === 'delete') {
            const orgName = args[1];
            if (!orgName) {
                output.error('Usage: monomind org delete <name>');
                return { success: false, message: 'org name required' };
            }
            if (!/^[a-z0-9][a-z0-9_-]*$/i.test(orgName)) {
                output.error(`Invalid org name: ${orgName}`);
                return { success: false, message: 'invalid org name' };
            }
            const confirmed = args.includes('--yes') || args.includes('-y');
            if (!confirmed) {
                output.warning(`This will permanently delete org "${orgName}" and all its data.`);
                output.warning('Pass --yes to confirm.');
                return { success: false, message: 'confirmation required' };
            }
            const cwd = resolve(context.cwd || process.cwd());
            const orgsDir = join(cwd, '.monomind', 'orgs');
            const configFile = join(orgsDir, `${orgName}.json`);
            if (!existsSync(configFile)) {
                output.error(`Org not found: ${orgName}`);
                return { success: false, message: 'org not found' };
            }
            const suffixes = ['', '-state', '-goals', '-routines', '-approvals', '-activity',
                '-issues', '-members', '-projects', '-workspaces', '-worktrees', '-environments',
                '-plugins', '-adapters', '-budgets', '-threads', '-secrets', '-join-requests',
                '-bootstrap', '-project-workspaces', '-approval-comments', '-skills'];
            let removed = 0;
            for (const suf of suffixes) {
                for (const ext of ['.json', '.jsonl']) {
                    const f = join(orgsDir, `${orgName}${suf}${ext}`);
                    try {
                        if (existsSync(f)) {
                            unlinkSync(f);
                            removed++;
                        }
                    }
                    catch (_) { }
                }
            }
            // Remove stop file
            try {
                unlinkSync(join(orgsDir, '.stops', `${orgName}.stop`));
            }
            catch (_) { }
            // Remove org subdirectory
            const orgSubDir = join(orgsDir, orgName);
            try {
                if (existsSync(orgSubDir))
                    rmSync(orgSubDir, { recursive: true, force: true });
            }
            catch (_) { }
            // Remove loop prompt file
            try {
                unlinkSync(join(cwd, '.monomind', 'loops', `${orgName}.md`));
            }
            catch (_) { }
            // Remove run prompt file
            try {
                unlinkSync(join(cwd, '.monomind', 'orgs', `${orgName}-run.md`));
            }
            catch (_) { }
            output.success(`Org "${orgName}" deleted (${removed} file(s) removed).`);
            return { success: true };
        }
        output.error(`Unknown subcommand: ${sub}. Run "monomind org help" for usage.`);
        return { success: false, message: `unknown subcommand: ${sub}` };
    },
};
export default orgCommand;
//# sourceMappingURL=org.js.map