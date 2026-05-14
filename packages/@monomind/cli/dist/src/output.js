/**
 * CLI Output Formatter
 * Advanced output formatting with tables, progress bars, and colors
 */
// ============================================
// Color Support
// ============================================
const COLORS = {
    // Standard colors
    reset: '\x1b[0m',
    bold: '\x1b[1m',
    dim: '\x1b[2m',
    italic: '\x1b[3m',
    underline: '\x1b[4m',
    // Foreground colors
    black: '\x1b[30m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    magenta: '\x1b[35m',
    cyan: '\x1b[36m',
    white: '\x1b[37m',
    gray: '\x1b[90m',
    // Bright foreground colors
    brightRed: '\x1b[91m',
    brightGreen: '\x1b[92m',
    brightYellow: '\x1b[93m',
    brightBlue: '\x1b[94m',
    brightMagenta: '\x1b[95m',
    brightCyan: '\x1b[96m',
    brightWhite: '\x1b[97m',
    // Background colors
    bgBlack: '\x1b[40m',
    bgRed: '\x1b[41m',
    bgGreen: '\x1b[42m',
    bgYellow: '\x1b[43m',
    bgBlue: '\x1b[44m',
    bgMagenta: '\x1b[45m',
    bgCyan: '\x1b[46m',
    bgWhite: '\x1b[47m'
};
export class OutputFormatter {
    colorEnabled;
    outputStream;
    errorStream;
    verbosity;
    constructor(options = {}) {
        this.colorEnabled = options.color ?? this.supportsColor();
        this.outputStream = process.stdout;
        this.errorStream = process.stderr;
        this.verbosity = options.verbosity ?? 'normal';
    }
    /**
     * Set verbosity level
     * - quiet: Only errors and direct results
     * - normal: Errors, warnings, info, and results
     * - verbose: All of normal + debug messages
     * - debug: All output including trace
     */
    setVerbosity(level) {
        this.verbosity = level;
    }
    getVerbosity() {
        return this.verbosity;
    }
    isQuiet() {
        return this.verbosity === 'quiet';
    }
    isVerbose() {
        return this.verbosity === 'verbose' || this.verbosity === 'debug';
    }
    isDebug() {
        return this.verbosity === 'debug';
    }
    supportsColor() {
        // Check for NO_COLOR environment variable
        if (process.env.NO_COLOR !== undefined)
            return false;
        // Check for FORCE_COLOR environment variable
        if (process.env.FORCE_COLOR !== undefined)
            return true;
        // Check if stdout is a TTY
        return process.stdout.isTTY ?? false;
    }
    // ============================================
    // Color Methods
    // ============================================
    color(text, ...colors) {
        if (!this.colorEnabled)
            return text;
        const codes = colors.map(c => COLORS[c]).join('');
        return `${codes}${text}${COLORS.reset}`;
    }
    bold(text) {
        return this.color(text, 'bold');
    }
    dim(text) {
        return this.color(text, 'dim');
    }
    success(text) {
        return this.color(text, 'green');
    }
    error(text) {
        return this.color(text, 'red');
    }
    warning(text) {
        return this.color(text, 'yellow');
    }
    info(text) {
        return this.color(text, 'blue');
    }
    highlight(text) {
        return this.color(text, 'cyan', 'bold');
    }
    // ============================================
    // Output Methods
    // ============================================
    write(text) {
        this.outputStream.write(text);
    }
    writeln(text = '') {
        this.outputStream.write(text + '\n');
    }
    writeError(text) {
        this.errorStream.write(text);
    }
    writeErrorln(text = '') {
        this.errorStream.write(text + '\n');
    }
    // ============================================
    // Formatted Output Methods
    // ============================================
    printSuccess(message) {
        // Success always shows (result output)
        const icon = this.color('[OK]', 'green', 'bold');
        this.writeln(`${icon} ${message}`);
    }
    printError(message, details) {
        // Errors always show
        const icon = this.color('[ERROR]', 'red', 'bold');
        this.writeErrorln(`${icon} ${message}`);
        if (details) {
            this.writeErrorln(this.dim(`  ${details}`));
        }
    }
    printWarning(message) {
        // Warnings suppressed in quiet mode
        if (this.verbosity === 'quiet')
            return;
        const icon = this.color('[WARN]', 'yellow', 'bold');
        this.writeln(`${icon} ${message}`);
    }
    printInfo(message) {
        // Info suppressed in quiet mode
        if (this.verbosity === 'quiet')
            return;
        const icon = this.color('[INFO]', 'blue', 'bold');
        this.writeln(`${icon} ${message}`);
    }
    printDebug(message) {
        // Debug only shows in verbose/debug mode
        if (this.verbosity !== 'verbose' && this.verbosity !== 'debug')
            return;
        const icon = this.color('[DEBUG]', 'gray');
        this.writeln(`${icon} ${this.dim(message)}`);
    }
    printTrace(message) {
        // Trace only shows in debug mode
        if (this.verbosity !== 'debug')
            return;
        const icon = this.color('[TRACE]', 'gray', 'dim');
        this.writeln(`${icon} ${this.dim(message)}`);
    }
    // ============================================
    // Table Formatting
    // ============================================
    table(options) {
        const { columns, data, border = true, header = true, padding = 1, maxWidth } = options;
        // Calculate column widths
        const widths = this.calculateColumnWidths(columns, data, maxWidth);
        const lines = [];
        const pad = ' '.repeat(padding);
        // Border characters
        const borderChars = border ? {
            topLeft: '+', topRight: '+', bottomLeft: '+', bottomRight: '+',
            horizontal: '-', vertical: '|',
            leftT: '+', rightT: '+', topT: '+', bottomT: '+', cross: '+'
        } : {
            topLeft: '', topRight: '', bottomLeft: '', bottomRight: '',
            horizontal: '', vertical: ' ',
            leftT: '', rightT: '', topT: '', bottomT: '', cross: ''
        };
        // Top border
        if (border) {
            lines.push(this.createBorderLine(widths, borderChars, 'top', padding));
        }
        // Header row
        if (header) {
            const headerRow = columns.map((col, i) => {
                const text = this.truncate(col.header, widths[i]);
                return pad + this.alignText(this.bold(text), widths[i], col.align) + pad;
            }).join(borderChars.vertical);
            lines.push(`${borderChars.vertical}${headerRow}${borderChars.vertical}`);
            // Header separator
            if (border) {
                lines.push(this.createBorderLine(widths, borderChars, 'middle', padding));
            }
        }
        // Data rows
        for (const row of data) {
            const rowCells = columns.map((col, i) => {
                let value = row[col.key];
                // Apply formatter if provided
                if (col.format) {
                    value = col.format(value);
                }
                else {
                    value = String(value ?? '');
                }
                const text = this.truncate(String(value), widths[i]);
                return pad + this.alignText(text, widths[i], col.align) + pad;
            }).join(borderChars.vertical);
            lines.push(`${borderChars.vertical}${rowCells}${borderChars.vertical}`);
        }
        // Bottom border
        if (border) {
            lines.push(this.createBorderLine(widths, borderChars, 'bottom', padding));
        }
        return lines.join('\n');
    }
    printTable(options) {
        this.writeln(this.table(options));
    }
    calculateColumnWidths(columns, data, maxWidth) {
        const widths = columns.map((col, i) => {
            // Start with header width
            let width = col.header.length;
            // Check all data values
            for (const row of data) {
                let value = row[col.key];
                if (col.format) {
                    value = col.format(value);
                }
                const len = this.stripAnsi(String(value ?? '')).length;
                width = Math.max(width, len);
            }
            // Apply column-specific width limit
            if (col.width) {
                width = Math.min(width, col.width);
            }
            return width;
        });
        // Apply max width constraint
        if (maxWidth) {
            const totalWidth = widths.reduce((a, b) => a + b, 0) + (columns.length * 3) + 1;
            if (totalWidth > maxWidth) {
                const reduction = (totalWidth - maxWidth) / columns.length;
                return widths.map(w => Math.max(3, Math.floor(w - reduction)));
            }
        }
        return widths;
    }
    createBorderLine(widths, chars, position, padding) {
        const cellWidth = (w) => chars.horizontal.repeat(w + (padding * 2));
        const cells = widths.map(cellWidth).join(position === 'top' ? chars.topT :
            position === 'bottom' ? chars.bottomT :
                chars.cross);
        const left = position === 'top' ? chars.topLeft : position === 'bottom' ? chars.bottomLeft : chars.leftT;
        const right = position === 'top' ? chars.topRight : position === 'bottom' ? chars.bottomRight : chars.rightT;
        return `${left}${cells}${right}`;
    }
    alignText(text, width, align = 'left') {
        const len = this.stripAnsi(text).length;
        const padding = width - len;
        if (padding <= 0)
            return text;
        switch (align) {
            case 'right':
                return ' '.repeat(padding) + text;
            case 'center':
                const left = Math.floor(padding / 2);
                const right = padding - left;
                return ' '.repeat(left) + text + ' '.repeat(right);
            default:
                return text + ' '.repeat(padding);
        }
    }
    truncate(text, maxLength) {
        const stripped = this.stripAnsi(text);
        if (stripped.length <= maxLength)
            return text;
        return stripped.slice(0, maxLength - 3) + '...';
    }
    stripAnsi(text) {
        return text.replace(/\x1b\[[0-9;]*m/g, '');
    }
    // ============================================
    // Progress Bar
    // ============================================
    createProgress(options) {
        return new Progress(this, options);
    }
    progressBar(current, total, width = 40) {
        const percent = Math.min(100, Math.max(0, (current / total) * 100));
        const filled = Math.round((width * percent) / 100);
        const empty = width - filled;
        const bar = this.color('#'.repeat(filled), 'green') +
            this.dim('-'.repeat(empty));
        return `[${bar}] ${percent.toFixed(1)}%`;
    }
    // ============================================
    // Spinner
    // ============================================
    createSpinner(options) {
        return new Spinner(this, options);
    }
    // ============================================
    // JSON Output
    // ============================================
    json(data, pretty = true) {
        return pretty ? JSON.stringify(data, null, 2) : JSON.stringify(data);
    }
    printJson(data, pretty = true) {
        this.writeln(this.json(data, pretty));
    }
    // ============================================
    // List Output
    // ============================================
    list(items, bullet = '-') {
        return items.map(item => `  ${bullet} ${item}`).join('\n');
    }
    printList(items, bullet = '-') {
        this.writeln(this.list(items, bullet));
    }
    numberedList(items) {
        return items.map((item, i) => `  ${i + 1}. ${item}`).join('\n');
    }
    printNumberedList(items) {
        this.writeln(this.numberedList(items));
    }
    // ============================================
    // Box Output
    // ============================================
    box(content, title) {
        const lines = content.split('\n');
        const maxLen = Math.max(...lines.map(l => this.stripAnsi(l).length), title?.length ?? 0);
        const width = maxLen + 4;
        const border = {
            topLeft: '+', topRight: '+',
            bottomLeft: '+', bottomRight: '+',
            horizontal: '-', vertical: '|'
        };
        const result = [];
        // Top border with optional title
        if (title) {
            const titleText = ` ${title} `;
            const leftPad = Math.floor((width - titleText.length - 2) / 2);
            const rightPad = width - titleText.length - leftPad - 2;
            result.push(border.topLeft +
                border.horizontal.repeat(leftPad) +
                this.bold(titleText) +
                border.horizontal.repeat(rightPad) +
                border.topRight);
        }
        else {
            result.push(border.topLeft + border.horizontal.repeat(width - 2) + border.topRight);
        }
        // Content lines
        for (const line of lines) {
            const stripped = this.stripAnsi(line);
            const padding = maxLen - stripped.length;
            result.push(`${border.vertical} ${line}${' '.repeat(padding)} ${border.vertical}`);
        }
        // Bottom border
        result.push(border.bottomLeft + border.horizontal.repeat(width - 2) + border.bottomRight);
        return result.join('\n');
    }
    printBox(content, title) {
        this.writeln(this.box(content, title));
    }
    setColorEnabled(enabled) {
        this.colorEnabled = enabled;
    }
    isColorEnabled() {
        return this.colorEnabled;
    }
}
// ============================================
// Progress Class
// ============================================
export class Progress {
    current;
    total;
    width;
    startTime;
    formatter;
    showPercentage;
    showETA;
    lastRender = '';
    constructor(formatter, options) {
        this.formatter = formatter;
        this.current = options.current ?? 0;
        this.total = options.total;
        this.width = options.width ?? 40;
        this.showPercentage = options.showPercentage ?? true;
        this.showETA = options.showETA ?? true;
        this.startTime = Date.now();
    }
    update(current) {
        this.current = current;
        this.render();
    }
    increment(amount = 1) {
        this.update(this.current + amount);
    }
    render() {
        const bar = this.formatter.progressBar(this.current, this.total, this.width);
        let output = bar;
        if (this.showETA && this.current > 0) {
            const elapsed = Date.now() - this.startTime;
            const rate = this.current / elapsed;
            const remaining = this.total - this.current;
            const eta = remaining / rate;
            if (isFinite(eta)) {
                output += ` ETA: ${this.formatTime(eta)}`;
            }
        }
        // Clear previous line and write new
        if (this.lastRender) {
            process.stdout.write('\r' + ' '.repeat(this.lastRender.length) + '\r');
        }
        process.stdout.write(output);
        this.lastRender = output;
    }
    finish() {
        this.current = this.total;
        this.render();
        process.stdout.write('\n');
    }
    formatTime(ms) {
        const seconds = Math.floor(ms / 1000);
        const minutes = Math.floor(seconds / 60);
        const hours = Math.floor(minutes / 60);
        if (hours > 0) {
            return `${hours}h ${minutes % 60}m`;
        }
        else if (minutes > 0) {
            return `${minutes}m ${seconds % 60}s`;
        }
        else {
            return `${seconds}s`;
        }
    }
}
// ============================================
// Spinner Class
// ============================================
export class Spinner {
    formatter;
    text;
    frames;
    interval = null;
    frameIndex = 0;
    static SPINNERS = {
        dots: ['...', '..:', '.::', ':::', '::.', ':..',],
        line: ['-', '\\', '|', '/'],
        arc: ['◜', '◠', '◝', '◞', '◡', '◟'],
        circle: ['◐', '◓', '◑', '◒'],
        arrows: ['←', '↖', '↑', '↗', '→', '↘', '↓', '↙']
    };
    constructor(formatter, options) {
        this.formatter = formatter;
        this.text = options.text;
        this.frames = Spinner.SPINNERS[options.spinner ?? 'dots'];
    }
    start() {
        if (this.interval)
            return;
        this.interval = setInterval(() => {
            this.render();
            this.frameIndex = (this.frameIndex + 1) % this.frames.length;
        }, 100);
        this.interval.unref();
        this.render();
    }
    stop(message) {
        if (this.interval) {
            clearInterval(this.interval);
            this.interval = null;
        }
        // Clear the line
        process.stdout.write('\r' + ' '.repeat(this.text.length + 10) + '\r');
        if (message) {
            this.formatter.writeln(message);
        }
    }
    succeed(message) {
        this.stop(this.formatter.success(message ?? this.text));
    }
    fail(message) {
        this.stop(this.formatter.error(message ?? this.text));
    }
    render() {
        const frame = this.formatter.info(this.frames[this.frameIndex]);
        process.stdout.write(`\r${frame} ${this.text}`);
    }
    setText(text) {
        this.text = text;
    }
}
// Export singleton instance
export const output = new OutputFormatter();
//# sourceMappingURL=output.js.map