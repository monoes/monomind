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
export declare const VIDEO_EXTENSIONS: Set<string>;
export declare function isUrl(input: string): boolean;
/**
 * Download audio from a URL using yt-dlp.
 * Returns the path to the downloaded audio file.
 * Cached: if a file with the same URL hash already exists it is returned immediately.
 *
 * @throws {Error} if yt-dlp is not installed.
 */
export declare function downloadAudio(url: string, outputDir: string): Promise<string>;
/**
 * Build a domain hint for Whisper from a set of god-node labels.
 * Mirrors graphify's `build_whisper_prompt`.
 */
export declare function buildWhisperPrompt(godNodeLabels: string[]): string;
export interface TranscribeOptions {
    /** Directory to write transcript files. Default: monograph-out/transcripts */
    outputDir?: string;
    /** Initial prompt / domain hint passed to Whisper. */
    initialPrompt?: string;
    /** Re-transcribe even if transcript already exists. Default: false */
    force?: boolean;
}
export interface TranscribeResult {
    transcriptPath: string;
    /** Number of non-empty lines in the transcript. */
    lineCount: number;
    /** Whether the transcript was loaded from cache (not freshly generated). */
    fromCache: boolean;
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
export declare function transcribe(input: string, options?: TranscribeOptions): Promise<TranscribeResult>;
/**
 * Transcribe a list of video/audio files or URLs.
 * Already-transcribed files are returned from cache instantly.
 * The `initialPrompt` is shared across all files.
 *
 * @param inputs  - Array of file paths or URLs.
 * @param options - Shared transcription options.
 * @returns Array of TranscribeResult (one per input, in order).
 */
export declare function transcribeAll(inputs: string[], options?: TranscribeOptions): Promise<TranscribeResult[]>;
//# sourceMappingURL=transcribe.d.ts.map