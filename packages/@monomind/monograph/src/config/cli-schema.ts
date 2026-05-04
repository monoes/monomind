// Generate a JSON Schema document describing the monograph CLI commands.

export interface CliParam {
  name: string;
  type: 'string' | 'boolean' | 'number' | 'array';
  description: string;
  required?: boolean;
  default?: unknown;
  enum?: string[];
}

export interface CliSubcommand {
  name: string;
  description: string;
  params: CliParam[];
}

export interface CliSchema {
  name: string;
  version: string;
  description: string;
  subcommands: CliSubcommand[];
}

const COMMON_PARAMS: CliParam[] = [
  { name: 'reporter', type: 'string', description: 'Output format', enum: ['human', 'json', 'compact', 'markdown'] },
  { name: 'no-gitignore', type: 'boolean', description: 'Disable .gitignore respect', default: false },
];

export function buildCliSchema(version = '1.0.0'): CliSchema {
  return {
    name: 'monograph',
    version,
    description: 'Monograph code analysis CLI',
    subcommands: [
      {
        name: 'analyze',
        description: 'Detect unused files, exports, dependencies, and more',
        params: [
          { name: 'root', type: 'string', description: 'Project root', required: true },
          { name: 'entry', type: 'array', description: 'Entry point patterns' },
          { name: 'project', type: 'string', description: 'Path to tsconfig.json' },
          { name: 'production', type: 'boolean', description: 'Apply production mode filter', default: false },
          { name: 'include-entry-exports', type: 'boolean', description: 'Include entry file exports in analysis', default: false },
          { name: 'changed-since', type: 'string', description: 'Only report issues in files changed since git ref' },
          { name: 'group-by', type: 'string', description: 'Group output by owner/directory/package/section', enum: ['owner', 'directory', 'package', 'section'] },
          ...COMMON_PARAMS,
        ],
      },
      {
        name: 'health',
        description: 'Compute function complexity, maintainability, and health scores',
        params: [
          { name: 'root', type: 'string', description: 'Project root', required: true },
          { name: 'max-cyclomatic', type: 'number', description: 'Cyclomatic complexity threshold', default: 10 },
          { name: 'max-cognitive', type: 'number', description: 'Cognitive complexity threshold', default: 15 },
          { name: 'max-crap', type: 'number', description: 'CRAP score threshold', default: 30 },
          { name: 'coverage', type: 'string', description: 'Path to Istanbul coverage JSON' },
          { name: 'save-snapshot', type: 'boolean', description: 'Save a VitalSigns snapshot', default: false },
          { name: 'trend', type: 'boolean', description: 'Show trend vs last snapshot', default: false },
          ...COMMON_PARAMS,
        ],
      },
      {
        name: 'find-dupes',
        description: 'Detect code duplication using token-based clone detection',
        params: [
          { name: 'root', type: 'string', description: 'Project root', required: true },
          { name: 'min-tokens', type: 'number', description: 'Minimum token count', default: 50 },
          { name: 'min-lines', type: 'number', description: 'Minimum line count', default: 5 },
          { name: 'cross-language', type: 'boolean', description: 'Enable cross-language detection', default: false },
          ...COMMON_PARAMS,
        ],
      },
    ],
  };
}

export function schemaToJsonString(schema: CliSchema): string {
  return JSON.stringify(schema, null, 2);
}
