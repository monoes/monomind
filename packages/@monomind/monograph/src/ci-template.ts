export type CiProvider = 'github' | 'gitlab';

export interface CiTemplateOptions {
  provider: CiProvider;
  monographVersion?: string;   // default 'latest'
  failOnNewDebt?: boolean;     // default true
  healthThreshold?: string;    // e.g. 'B' — fail if below this grade
}

export interface CiTemplate {
  filename: string;         // e.g. '.github/workflows/monograph.yml'
  content: string;          // the YAML/config content
  description: string;
}

// Grade letters that are >= a given threshold (A is highest, F is lowest)
const GRADE_ORDER = ['A', 'B', 'C', 'D', 'F'];

function gradesAtOrAbove(threshold: string): string {
  const idx = GRADE_ORDER.indexOf(threshold.toUpperCase());
  if (idx === -1) return threshold.toUpperCase();
  return GRADE_ORDER.slice(0, idx + 1).join('');
}

export function generateCiTemplate(options: CiTemplateOptions): CiTemplate {
  const version = options.monographVersion ?? 'latest';
  const threshold = options.healthThreshold ?? 'B';
  const acceptableGrades = gradesAtOrAbove(threshold);

  if (options.provider === 'github') {
    const content = `name: Monograph Graph Health
on:
  push:
    branches: [main]
  pull_request:
    branches: [main]
jobs:
  monograph:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0
      - uses: actions/setup-node@v4
        with:
          node-version: '20'
      - name: Run monograph
        run: npx @monoes/monograph@${version} build && npx @monoes/monograph@${version} health --format json > monograph-report.json
      - name: Check health gate
        run: |
          GRADE=$(cat monograph-report.json | node -e "const d=require('fs').readFileSync('/dev/stdin','utf8'); console.log(JSON.parse(d).grade)")
          echo "Health grade: $GRADE"
          [[ "$GRADE" =~ ^[${acceptableGrades}] ]] || (echo "Health below threshold ${threshold}" && exit 1)
      - name: Upload report
        uses: actions/upload-artifact@v4
        with:
          name: monograph-report
          path: monograph-report.json
`;

    return {
      filename: '.github/workflows/monograph.yml',
      content,
      description: 'GitHub Actions workflow that builds the Monograph graph, checks the health grade gate, and uploads the report as an artifact.',
    };
  }

  // GitLab
  const content = `monograph:
  image: node:20
  script:
    - npx @monoes/monograph@${version} build
    - npx @monoes/monograph@${version} health --format codeclimate > gl-code-quality-report.json
  artifacts:
    reports:
      codequality: gl-code-quality-report.json
`;

  return {
    filename: '.gitlab-ci.yml',
    content,
    description: 'GitLab CI job that builds the Monograph graph and publishes a Code Quality report via the codeclimate artifact.',
  };
}
