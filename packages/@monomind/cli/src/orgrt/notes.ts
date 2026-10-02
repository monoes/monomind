// packages/@monomind/cli/src/orgrt/notes.ts
/**
 * Role notes (org sections spec 6.10, Phase 2).
 *
 * A role appends to its own `<orgDir>/notes/<role>.md` with org_note_append.
 * The file is append-only (R7): curation is a new "current state" entry that
 * supersedes older ones, never a rewrite. A fresh session starts with the last
 * current state plus the appends after it, within a 4,000-character budget
 * that also respects the 12,000-character limit on a first message's variable
 * parts (packet.ts). An entry is included whole or not at all.
 *
 * Each entry carries its own length in its header, so text that itself looks
 * like a header stays part of the entry. The path comes from the calling role,
 * so one role cannot append to another's file through the tool.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/** What notes injection may add to a first message. */
export const NOTES_BUDGET = 4000;
/** The longest single entry; a longer one is rejected, not cut. */
export const MAX_NOTE_CHARS = 4000;

export type NoteKind = 'note' | 'current_state';

export interface NoteEntry {
  at: string;
  kind: NoteKind;
  text: string;
}

/** `<orgDir>/notes/<role>.md`, with the role id reduced to a safe file name. */
export function notesPath(orgDir: string, role: string): string {
  return join(orgDir, 'notes', `${role.replace(/[^A-Za-z0-9._-]/g, '_')}.md`);
}

/** Append one entry. Throws for an empty or over-long text, writing nothing. */
export function appendNote(
  orgDir: string,
  role: string,
  text: string,
  kind: NoteKind,
  at = new Date(),
): void {
  if (text.trim() === '') throw new Error('the note is empty');
  if (text.length > MAX_NOTE_CHARS)
    throw new Error(
      `the note is ${text.length} characters, over ${MAX_NOTE_CHARS}; keep it short, or put detail in a file and note its path (nothing is truncated)`,
    );
  const file = notesPath(orgDir, role);
  mkdirSync(join(orgDir, 'notes'), { recursive: true });
  appendFileSync(file, `## ${at.toISOString()} · ${kind} · ${text.length}\n${text}\n\n`);
}

const HEADER = /^## (\S+) · (note|current_state) · (\d+)\n/;

/** The entries of a role's notes, oldest first; a missing file or a torn final entry reads as what is whole. */
export function readNotes(orgDir: string, role: string): NoteEntry[] {
  const file = notesPath(orgDir, role);
  if (!existsSync(file)) return [];
  const raw = readFileSync(file, 'utf8');
  const out: NoteEntry[] = [];
  let pos = 0;
  while (pos < raw.length) {
    const m = HEADER.exec(raw.slice(pos));
    if (!m) break;
    const len = Number(m[3]);
    const start = pos + m[0].length;
    if (start + len > raw.length) break;
    out.push({ at: m[1], kind: m[2] as NoteKind, text: raw.slice(start, start + len) });
    pos = start + len + 2; // the blank line that ends an entry
  }
  return out;
}

const INTRO = 'Your notes from earlier work (oldest first; add to them with org_note_append):';
const render = (e: NoteEntry): string =>
  `[${e.at} · ${e.kind === 'current_state' ? 'current state' : 'note'}]\n${e.text}`;
const blockOf = (es: NoteEntry[]): string =>
  es.length ? `${INTRO}\n\n${es.map(render).join('\n\n')}` : '';

export interface NotesSelection {
  /** The text to inject; empty when nothing fits or there is nothing. */
  block: string;
  included: NoteEntry[];
  /** Entries left out: older than the current state, or past the budget. */
  omitted: number;
}

/** The last current state plus the appends after it (or, with none, the most
 *  recent entries), newest dropped last, whole entries only, within `budget`. */
export function selectNotes(entries: NoteEntry[], budget: number): NotesSelection {
  const none = { block: '', included: [] as NoteEntry[], omitted: entries.length };
  if (!entries.length || budget <= 0) return none;
  let anchor = -1;
  entries.forEach((e, i) => {
    if (e.kind === 'current_state') anchor = i;
  });
  let chosen: NoteEntry[] = [];
  const fits = (es: NoteEntry[]): boolean => blockOf(es).length <= budget;
  if (anchor >= 0) {
    chosen = [entries[anchor]];
    if (!fits(chosen)) return none;
    for (let i = entries.length - 1; i > anchor; i--) {
      const next = [entries[anchor], ...entries.slice(i)];
      if (!fits(next)) break;
      chosen = next;
    }
  } else {
    for (let i = entries.length - 1; i >= 0; i--) {
      const next = entries.slice(i);
      if (!fits(next)) break;
      chosen = next;
    }
  }
  if (!chosen.length) return none;
  return { block: blockOf(chosen), included: chosen, omitted: entries.length - chosen.length };
}

export const NOTE_APPEND_HELP = `Append an entry to your own notes file, which carries across your tasks and into every fresh session you start. Append-only: you cannot edit or delete an earlier entry. To curate, append a new entry with current_state: true that restates what still matters; the next session starts with your last current state and the notes after it. Keep entries short (at most ${MAX_NOTE_CHARS} characters, never truncated) and put detail in a file you name.`;
