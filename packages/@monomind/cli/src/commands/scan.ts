/**
 * Scan Command
 *
 * Re-scans the working directory for content-type capabilities and
 * persists an updated fingerprint to .monomind/.
 */
import type { Command, CommandContext, CommandResult } from '../types.js';
import { scanDirectory, saveFingerprint } from '../capabilities/scanner.js';
import path from 'path';

export const scanCommand: Command = {
  name: 'scan',
  description: 'Scan directory and update capability fingerprint',
  action: async (ctx: CommandContext): Promise<CommandResult> => {
    try {
      const scan = await scanDirectory(ctx.cwd);
      const monomindDir = path.join(ctx.cwd, '.monomind');
      await saveFingerprint(scan, monomindDir);

      console.log(`\nScanned ${scan.totalFiles} files in ${scan.root}`);
      console.log(`Git: ${scan.git ? 'yes' : 'no'}`);
      console.log(`\nCapabilities detected:`);

      for (const [name, score] of Object.entries(scan.capabilities)) {
        if (score.confidence > 0.1) {
          console.log(`  ✓ ${name} (${(score.confidence * 100).toFixed(0)}% confidence, ${score.files} files)`);
        }
      }

      const inactive = Object.entries(scan.capabilities).filter(([, s]) => s.confidence <= 0.1);
      if (inactive.length > 0) {
        console.log(`\nNot detected: ${inactive.map(([n]) => n).join(', ')}`);
      }

      return { success: true };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : String(error) };
    }
  },
};

export default scanCommand;
