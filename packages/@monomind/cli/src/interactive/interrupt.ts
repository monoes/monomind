import * as readline from 'node:readline';

export type InterruptDecision = 'approved' | 'rejected' | 'edited';

export interface InterruptPromptResult {
  decision: InterruptDecision;
  editedTask?: string;
}

export interface InterruptConfig {
  interruptBefore: string[];       // agent slugs requiring approval
  confidenceThreshold?: number;    // interrupt when routing confidence < this
  autoApprove?: boolean;           // CI mode: auto-approve all
}

export class InterruptRegistry {
  private config: InterruptConfig = { interruptBefore: [] };

  load(config: InterruptConfig): void {
    this.config = config;
  }

  shouldInterrupt(agentSlug: string, confidence?: number): boolean {
    if (this.config.autoApprove) return false;
    if (this.config.interruptBefore.includes(agentSlug)) return true;
    if (
      confidence !== undefined &&
      this.config.confidenceThreshold !== undefined &&
      confidence < this.config.confidenceThreshold
    ) {
      return true;
    }
    return false;
  }

  getConfig(): InterruptConfig {
    return { ...this.config };
  }
}

export const interruptRegistry = new InterruptRegistry();

export class InterruptController {
  async prompt(
    agentSlug: string,
    taskDescription: string,
    checkpointId: string,
  ): Promise<InterruptPromptResult> {
    // Non-TTY / CI mode
    if (!process.stdin.isTTY || process.env.CI_AUTO_APPROVE === '1') {
      return { decision: 'approved' };
    }

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    // Strip control characters from interpolated fields. ANSI escape sequences
    // in any of these fields would let a malicious agent or LLM-generated task
    // description redraw the screen and trick the user into approving an
    // entirely different action than the one shown — defeating this very gate.
    const safe = (s: unknown): string =>
      String(s ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, '?').slice(0, 500);

    console.log('\n' + '='.repeat(60));
    console.log('[MONOMIND] Interrupt — Human approval required');
    console.log(`  Agent:      ${safe(agentSlug)}`);
    console.log(`  Task:       ${safe(taskDescription)}`);
    console.log(`  Checkpoint: ${safe(checkpointId)}`);
    console.log('='.repeat(60));
    console.log('  Options: [y] approve  [n] reject  [e] edit task');

    return new Promise<InterruptPromptResult>((resolve) => {
      rl.question('  Choice (y/n/e): ', (answer) => {
        rl.close();
        const trimmed = answer.trim().toLowerCase();
        if (trimmed === 'y' || trimmed === 'yes') {
          resolve({ decision: 'approved' });
        } else if (trimmed === 'e' || trimmed === 'edit') {
          const rl2 = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
          });
          rl2.question('  New task description: ', (newTask) => {
            rl2.close();
            resolve({ decision: 'edited', editedTask: newTask });
          });
        } else {
          resolve({ decision: 'rejected' });
        }
      });
    });
  }
}

export const interruptController = new InterruptController();
