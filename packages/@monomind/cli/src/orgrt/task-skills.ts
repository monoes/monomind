// packages/@monomind/cli/src/orgrt/task-skills.ts
/**
 * Per-task skill suggestions from a role's pool: Jev first, then the keyword
 * match in task-match.ts. Moved here from decision/catalogs.ts and
 * decision/picks.ts (both re-export them) so the Org Runtime no longer imports
 * those modules, which import the Org Runtime.
 */
import { acceptSkills, type CatalogItem, type PickOptions, pickWithJev } from '../decision/jev.js';
import { jevVisible } from '../decision/jev-visible.js';
import { listSkills } from './skill-library.js';
import {
  keywordSkills,
  PICK_BRIEF_CHARS,
  skillOutcomePrior,
  type TaskOutcome,
} from './task-match.js';

/** Org-library skills (project, user, bundled, and catalog skills approved for
 *  `jev`), optionally limited to `names`. */
export function orgSkillCatalog(root: string, names?: string[]): CatalogItem[] {
  const allow = names ? new Set(names) : null;
  return jevVisible(root, listSkills(root))
    .filter((s) => !allow || allow.has(s.name))
    .map((s) => ({ id: s.name, description: s.description, text: s.tags.join(' ') }));
}

/** Up to two skills from a role's pool that fit this task; [] = no suggestion.
 *  Jev decides when it answers (its "none" included); without a decision
 *  model, or when it fails, a keyword match over the pool does, biased by
 *  `history` toward skills whose tasks finished done. Either way only names
 *  from the pool can come back. */
export async function suggestTaskSkills(
  title: string,
  pool: string[],
  root: string,
  opts: PickOptions & {
    brief?: string;
    onMethod?: (method: 'jev' | 'keyword') => void;
    history?: TaskOutcome[];
  } = {},
): Promise<string[]> {
  const { brief, onMethod, history, ...pickOpts } = opts;
  const skills = orgSkillCatalog(root, pool);
  if (skills.length === 0) return [];
  const excerpt = brief?.slice(0, PICK_BRIEF_CHARS);
  const picked = await pickWithJev(
    excerpt ? `${title}\n\n${excerpt}` : title,
    { skills },
    { ...pickOpts, skillInstructions: 'Which of these skills would help most with this task?' },
  );
  // Only names from the pool that was sent reach the assignee's mailbox.
  const sent = new Set(skills.map((s) => s.id));
  if (picked?.skill) {
    onMethod?.('jev');
    return acceptSkills(picked.skill, pickOpts.env, 2).filter((id) => sent.has(id));
  }
  onMethod?.('keyword');
  return keywordSkills(
    { title, brief },
    skills,
    2,
    history?.length ? skillOutcomePrior(history) : undefined,
  );
}
