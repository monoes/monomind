# pr-enhance

AI-powered pull request enhancements.

## Usage
```bash
npx monobrain github pr-enhance [options]
```

## Options
- `--pr-number <n>` - Pull request number
- `--add-tests` - Add missing tests
- `--improve-docs` - Improve documentation
- `--check-security` - Security review

## Examples
```bash
# Enhance PR
npx monobrain github pr-enhance --pr-number 123

# Add tests
npx monobrain github pr-enhance --pr-number 123 --add-tests

# Full enhancement
npx monobrain github pr-enhance --pr-number 123 --add-tests --improve-docs
```
