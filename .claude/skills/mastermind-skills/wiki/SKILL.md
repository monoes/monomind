---
name: mastermind-wiki
description: Mastermind wiki — org-scoped knowledge base with ingest, query, maintain, lint, and distill operations. Stores durable synthesis in .monomind/orgs/<org>/wiki/ with page citations, raw sources, and change log. Port of Paperclip's LLM Wiki plugin skills adapted for mastermind orgs.
type: domain-skill
default_mode: auto
---

# Mastermind Wiki

This skill is invoked by `mastermind:wiki` or directly via `/mastermind:wiki`.

---

## Inputs

- `brain_context`: BRAIN CONTEXT block (injected by command, or loaded below if standalone)
- `org_name`: org whose wiki to operate on (required)
- `action`: query | ingest | list | maintain | lint | distill | page
- `question`: question or search term (required for query)
- `source`: path or URL to ingest (required for ingest)
- `page_slug`: wiki page slug to read/write (required for page)
- `content`: content to write to a page (required for page write)
- `caller`: command | master

---

## Wiki Structure

```
.monomind/orgs/<org>/wiki/
  index.md          ← navigation hub; must be kept current
  log.md            ← append-only change log
  concepts/         ← concepts, definitions, architectural decisions
  projects/         ← per-project knowledge (standup.md + index.md)
  synthesis/        ← synthesized answers filed from queries
  raw/              ← raw source material (never modified after ingest)
```

**Invariants:**
- Raw sources in `raw/` are NEVER modified after ingest
- Every durable page write must append a `log.md` entry
- `index.md` must be updated when pages are added or removed
- Answers cite wiki pages or raw sources inline, not in footnote blocks

---

## Step 0 — Brain Load (standalone only)

If `caller` is not "command", load brain context following _protocol.md Brain Load Procedure with namespace: `ops`.

---

## Step 1 — Resolve Wiki Root

```bash
orgFile=".monomind/orgs/${org_name}.json"
[ ! -f "$orgFile" ] && { echo "ERROR: Org '${org_name}' not found."; exit 1; }

wikiRoot=".monomind/orgs/${org_name}/wiki"
mkdir -p "$wikiRoot/concepts" "$wikiRoot/projects" "$wikiRoot/synthesis" "$wikiRoot/raw"

if [ ! -f "$wikiRoot/index.md" ]; then
  cat > "$wikiRoot/index.md" << EOF
# Wiki — ${org_name}

This is the org knowledge base. Navigate by category or search with \`/mastermind:wiki --action query\`.

## Concepts
(none yet)

## Projects
(none yet)

## Synthesis
(none yet)
EOF
fi

[ ! -f "$wikiRoot/log.md" ] && echo "# Wiki Log — ${org_name}" > "$wikiRoot/log.md"
```

---

## Step 2 — Execute Action

### query (default)

Answer a question from what the wiki contains, with citations.

```bash
[ -z "$question" ] && { echo "ERROR: --question required."; exit 1; }
echo "WIKI QUERY — ${org_name}"
echo "Q: $question"
echo "────────────────────────────────────────────────────────"

python3 - "$wikiRoot" "$question" <<'PYEOF'
import os, sys, re
root, query = sys.argv[1], sys.argv[2].lower()
hits = []

def scan_dir(d, prefix):
    if not os.path.isdir(d): return
    for fname in os.listdir(d):
        if not fname.endswith(".md"): continue
        fpath = os.path.join(d, fname)
        try:
            text = open(fpath).read()
            if query in text.lower():
                snippet = ""
                for line in text.split("\n"):
                    if query in line.lower():
                        snippet = line.strip()[:120]
                        break
                hits.append((prefix + "/" + fname, snippet))
        except: pass

scan_dir(os.path.join(root, "concepts"), "concepts")
scan_dir(os.path.join(root, "synthesis"), "synthesis")
scan_dir(os.path.join(root, "projects"), "projects")
scan_dir(os.path.join(root, "raw"), "raw")

if not hits:
    print("  No wiki pages match that query.")
    print("  Use --action ingest to add source material, or --action distill to synthesize from org data.")
else:
    print(f"  {len(hits)} page(s) match:")
    for path, snippet in hits[:10]:
        print(f"\n  [[{path}]]")
        if snippet: print(f"    → {snippet}")
PYEOF
```

### list

Show all wiki pages.

```bash
echo "WIKI INDEX — ${org_name}"
echo "────────────────────────────────────────────────────────"
cat "$wikiRoot/index.md"
echo ""
echo "  Raw sources: $(ls $wikiRoot/raw/ 2>/dev/null | wc -l) file(s)"
```

### ingest

Add a raw source file to the wiki. Raw sources are immutable after ingest.

```bash
[ -z "$source" ] && { echo "ERROR: --source required (path to file)."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
srcBase=$(basename "$source")
dstPath="$wikiRoot/raw/$srcBase"

if [ -f "$dstPath" ]; then
  echo "  Already ingested: $srcBase"
else
  cp "$source" "$dstPath" && echo "  Ingested: $srcBase → $wikiRoot/raw/"
  echo "$(date -u +%Y-%m-%d) | ingest | raw/$srcBase" >> "$wikiRoot/log.md"
fi
echo "  To synthesize a page from this source, use: /mastermind:wiki --action distill --source $srcBase"
```

### page

Read or write a specific wiki page.

```bash
[ -z "$page_slug" ] && { echo "ERROR: --page-slug required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)

if [ -n "$content" ]; then
  # Write/update
  pageDir="$wikiRoot/$(dirname $page_slug)"
  mkdir -p "$pageDir"
  pagePath="$wikiRoot/${page_slug}.md"
  echo "$content" > "$pagePath"
  echo "$(date -u +%Y-%m-%d) | update | ${page_slug}" >> "$wikiRoot/log.md"
  echo "  Page written: $pagePath"
  echo "  Remember to update index.md if this is a new page."
else
  # Read
  pagePath="$wikiRoot/${page_slug}.md"
  if [ -f "$pagePath" ]; then
    cat "$pagePath"
  else
    echo "  Page not found: $page_slug"
    echo "  Available pages:"
    find "$wikiRoot" -name "*.md" ! -name "index.md" ! -name "log.md" | sed "s|$wikiRoot/||"
  fi
fi
```

### distill

Synthesize a wiki page from raw sources and org data. The AI synthesizes based on context, writes the page, and logs it.

```bash
[ -z "$page_slug" ] && { echo "ERROR: --page-slug required."; exit 1; }
ts=$(date -u +%Y-%m-%dT%H:%M:%SZ)
pagePath="$wikiRoot/${page_slug}.md"

echo "WIKI DISTILL — ${org_name}"
echo "Target: ${page_slug}"
echo "────────────────────────────────────────────────────────"

if [ -n "$source" ] && [ -f "$wikiRoot/raw/$source" ]; then
  echo "Source: $wikiRoot/raw/$source"
  cat "$wikiRoot/raw/$source"
fi

echo ""
echo "  Use the above source material to write a synthesis page at $pagePath."
echo "  The page should: answer the most important questions, cite raw/ sources inline,"
echo "  use a terse factual voice, and avoid summarizing what is already obvious."
echo "  After writing, update index.md to link to the new page and append a distill log entry."
```

### maintain

Check wiki health: stale pages, missing index links, unreferenced raw sources.

```bash
echo "WIKI HEALTH — ${org_name}"
echo "────────────────────────────────────────────────────────"

python3 - "$wikiRoot" <<'PYEOF'
import os, sys
root = sys.argv[1]

pages = []
for subdir in ["concepts","projects","synthesis"]:
    d = os.path.join(root, subdir)
    if not os.path.isdir(d): continue
    for f in os.listdir(d):
        if f.endswith(".md"): pages.append(f"{subdir}/{f}")

raw_sources = os.listdir(os.path.join(root,"raw")) if os.path.isdir(os.path.join(root,"raw")) else []

# Check index.md links
index_text = open(os.path.join(root,"index.md")).read() if os.path.exists(os.path.join(root,"index.md")) else ""
missing_links = [p for p in pages if p not in index_text]
orphan_raw   = [r for r in raw_sources if r not in index_text and not any(r in open(os.path.join(root,p)).read() for p in pages if os.path.exists(os.path.join(root,p)))]

print(f"  Pages: {len(pages)}")
print(f"  Raw sources: {len(raw_sources)}")
print()
if missing_links:
    print(f"  ⚠ {len(missing_links)} page(s) not in index.md:")
    for p in missing_links: print(f"    · {p}")
else:
    print("  ✓ All pages listed in index.md")
if orphan_raw:
    print(f"\n  ⚠ {len(orphan_raw)} raw source(s) not referenced by any page:")
    for r in orphan_raw: print(f"    · raw/{r}")
else:
    print("  ✓ All raw sources referenced")
PYEOF
```

### lint

Validate page formatting: headers, citations, no broken links.

```bash
echo "WIKI LINT — ${org_name}"
echo "────────────────────────────────────────────────────────"

python3 - "$wikiRoot" <<'PYEOF'
import os, sys, re
root = sys.argv[1]
issues = []

for subdir in ["concepts","projects","synthesis"]:
    d = os.path.join(root, subdir)
    if not os.path.isdir(d): continue
    for fname in os.listdir(d):
        if not fname.endswith(".md"): continue
        fpath = os.path.join(d, fname)
        text = open(fpath).read()
        path = f"{subdir}/{fname}"
        if not text.strip().startswith("#"):
            issues.append(f"  {path}: missing H1 title")
        wikilinks = re.findall(r'\[\[([^\]]+)\]\]', text)
        for wl in wikilinks:
            candidate = os.path.join(root, wl.lstrip("/"))
            if not os.path.exists(candidate) and not os.path.exists(candidate+".md"):
                issues.append(f"  {path}: broken wiki-link [[{wl}]]")

if not issues:
    print("  ✓ No lint issues found.")
else:
    print(f"  {len(issues)} issue(s):")
    for i in issues: print(i)
PYEOF
```

---

## Step 3 — Return Output

```yaml
domain: ops
status: complete
action: <action>
org_name: <org_name>
wiki_root: .monomind/orgs/<org_name>/wiki/
```

---

## Step 4 — Brain Write (standalone only)

If `caller` is not "command", follow _protocol.md Brain Write Procedure for domain `ops`.
