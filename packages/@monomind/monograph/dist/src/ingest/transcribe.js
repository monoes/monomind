/**
 * Video / audio transcription support.
 *
 * Mirrors graphify's `transcribe.py`: converts video/audio files or URLs to
 * plain-text transcript files that the pipeline can then extract as document
 * nodes.
 *
 * Implementation strategy
 * -----------------------
 * TypeScript cannot import Python's faster-whisper directly.  Instead this
 * module shells out to the faster-whisper CLI (`faster-whisper`) or the
 * `whisper` CLI (OpenAI's original).  yt-dlp is used for URL audio downloads.
 * If neither tool is installed, functions throw descriptive errors.
 *
 * Environment variables
 * ---------------------
 * MONOGRAPH_WHISPER_MODEL   - Whisper model name (default: "base")
 * MONOGRAPH_WHISPER_PROMPT  - Override initial prompt for Whisper
 */
import { execFile } from 'child_process';
import { promisify } from 'util';
import { createHash } from 'crypto';
import { mkdirSync, existsSync, writeFileSync } from 'fs';
import { readFile } from 'fs/promises';
import path from 'path';
const execFileAsync = promisify(execFile);
// ── Constants ──────────────────────────────────────────────────────────────────
export const VIDEO_EXTENSIONS = new Set([
    '.mp4', '.mov', '.webm', '.mkv', '.avi', '.m4v',
    '.mp3', '.wav', '.m4a', '.ogg',
]);
const URL_PREFIXES = ['http://', 'https://', 'www.'];
const DEFAULT_MODEL = 'base';
const FALLBACK_PROMPT = 'Use proper punctuation and paragraph breaks.';
const DEFAULT_TRANSCRIPTS_DIR = 'monograph-out/transcripts';
// ── Helpers ────────────────────────────────────────────────────────────────────
export function isUrl(input) {
    return URL_PREFIXES.some(p => input.startsWith(p));
}
function getModel() {
    return process.env['MONOGRAPH_WHISPER_MODEL'] ?? DEFAULT_MODEL;
}
async function whisperCliAvailable() {
    for (const cmd of ['faster-whisper', 'whisper']) {
        try {
            await execFileAsync(cmd, ['--help']);
            return cmd;
        }
        catch {
            // not found — try next
        }
    }
    return null;
}
async function ytdlpAvailable() {
    try {
        await execFileAsync('yt-dlp', ['--version']);
        return true;
    }
    catch {
        return false;
    }
}
// ── Download audio ─────────────────────────────────────────────────────────────
/**
 * Download audio from a URL using yt-dlp.
 * Returns the path to the downloaded audio file.
 * Cached: if a file with the same URL hash already exists it is returned immediately.
 *
 * @throws {Error} if yt-dlp is not installed.
 */
export async function downloadAudio(url, outputDir) {
    if (!await ytdlpAvailable()) {
        throw new Error('Video URL download requires yt-dlp. Install it with: pip install yt-dlp');
    }
    mkdirSync(outputDir, { recursive: true });
    const urlHash = createHash('sha1').update(url).digest('hex').slice(0, 12);
    const audioExts = ['.m4a', '.opus', '.mp3', '.ogg', '.wav', '.webm'];
    // Return cached file if present
    for (const ext of audioExts) {
        const candidate = path.join(outputDir, `yt_${urlHash}${ext}`);
        if (existsSync(candidate)) {
            return candidate;
        }
    }
    const outTemplate = path.join(outputDir, `yt_${urlHash}.%(ext)s`);
    await execFileAsync('yt-dlp', [
        '--format', 'bestaudio[ext=m4a]/bestaudio/best',
        '--output', outTemplate,
        '--quiet',
        '--no-warnings',
        '--no-playlist',
        url,
    ]);
    // Find the downloaded file
    for (const ext of audioExts) {
        const candidate = path.join(outputDir, `yt_${urlHash}${ext}`);
        if (existsSync(candidate))
            return candidate;
    }
    throw new Error(`yt-dlp download completed but output file not found for URL: ${url}`);
}
// ── Whisper prompt ─────────────────────────────────────────────────────────────
/**
 * Build a domain hint for Whisper from a set of god-node labels.
 * Mirrors graphify's `build_whisper_prompt`.
 */
export function buildWhisperPrompt(godNodeLabels) {
    const override = process.env['MONOGRAPH_WHISPER_PROMPT'];
    if (override)
        return override;
    if (godNodeLabels.length === 0)
        return FALLBACK_PROMPT;
    const topics = godNodeLabels.slice(0, 5).join(', ');
    return `Technical discussion about ${topics}. Use proper punctuation and paragraph breaks.`;
}
/**
 * Transcribe a video/audio file or URL to a plain-text transcript.
 *
 * Requires either `faster-whisper` or `whisper` CLI to be on the PATH.
 * For URLs, also requires `yt-dlp`.
 *
 * @param input   - A local file path or a URL (http/https/www).
 * @param options - Transcription options.
 * @returns Resolved transcript path and metadata.
 */
export async function transcribe(input, options = {}) {
    const outDir = options.outputDir ?? DEFAULT_TRANSCRIPTS_DIR;
    mkdirSync(outDir, { recursive: true });
    // Resolve audio path
    let audioPath;
    if (isUrl(input)) {
        const dlDir = path.join(outDir, 'downloads');
        audioPath = await downloadAudio(input, dlDir);
    }
    else {
        audioPath = input;
    }
    const stem = path.basename(audioPath, path.extname(audioPath));
    const transcriptPath = path.join(outDir, `${stem}.txt`);
    // Return cached transcript if it exists
    if (!options.force && existsSync(transcriptPath)) {
        const content = await readFile(transcriptPath, 'utf-8');
        const lines = content.split('\n').filter(l => l.trim().length > 0);
        return { transcriptPath, lineCount: lines.length, fromCache: true };
    }
    // Find available Whisper CLI
    const whisperCmd = await whisperCliAvailable();
    if (!whisperCmd) {
        throw new Error('Video transcription requires faster-whisper or whisper CLI. ' +
            'Install with: pip install faster-whisper  or  pip install openai-whisper');
    }
    const model = getModel();
    const prompt = options.initialPrompt ?? FALLBACK_PROMPT;
    const args = [audioPath, '--model', model, '--output_format', 'txt', '--output_dir', outDir];
    if (prompt)
        args.push('--initial_prompt', prompt);
    await execFileAsync(whisperCmd, args);
    // Whisper may write <stem>.txt directly or <stem>.<ext>.txt — normalise
    if (!existsSync(transcriptPath)) {
        // Try with original extension included in stem
        const altPath = path.join(outDir, `${path.basename(audioPath)}.txt`);
        if (existsSync(altPath)) {
            // Rename to canonical path
            const content = await readFile(altPath, 'utf-8');
            writeFileSync(transcriptPath, content, 'utf-8');
        }
    }
    const content = existsSync(transcriptPath)
        ? await readFile(transcriptPath, 'utf-8')
        : '';
    const lines = content.split('\n').filter(l => l.trim().length > 0);
    return { transcriptPath, lineCount: lines.length, fromCache: false };
}
// ── Transcribe many ────────────────────────────────────────────────────────────
/**
 * Transcribe a list of video/audio files or URLs.
 * Already-transcribed files are returned from cache instantly.
 * The `initialPrompt` is shared across all files.
 *
 * @param inputs  - Array of file paths or URLs.
 * @param options - Shared transcription options.
 * @returns Array of TranscribeResult (one per input, in order).
 */
export async function transcribeAll(inputs, options = {}) {
    if (inputs.length === 0)
        return [];
    const results = [];
    for (const input of inputs) {
        try {
            results.push(await transcribe(input, options));
        }
        catch (err) {
            console.error(`[monograph transcribe] Failed for ${input}: ${err.message}`);
        }
    }
    return results;
}
//# sourceMappingURL=transcribe.js.map