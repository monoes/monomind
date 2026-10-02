#!/usr/bin/env python3
"""Per-role cost from Claude session transcripts of one trial (de-duplicated by
message.id). Usage: transcript-cost.py <trial name>. Prices per MTok:
input, output, cache read (0.1x input), cache write 5m (1.25x input)."""
import json, glob, os, re, sys, collections
PRICE = {'claude-opus-5': (5, 25, 0.5, 6.25), 'claude-sonnet-5': (2, 10, 0.2, 2.5), 'claude-haiku-4-5': (1, 5, 0.1, 1.25)}
roles = ['growth-lead','researcher','content-writer','brand-reviewer','social-publisher','community-manager','outreach-manager','site-seo','analyst']
name = sys.argv[1]
d = os.path.expanduser(f'~/.claude/projects/-var-tmp-mm-phase0-trials-{name}-workspace')
out = collections.defaultdict(lambda: collections.Counter())
for f in glob.glob(d + '/**/*.jsonl', recursive=True):
    seen = {}; role = None; model = None
    for line in open(f):
        try: e = json.loads(line)
        except Exception: continue
        if role is None and e.get('type') == 'user':
            txt = json.dumps(e.get('message', {}))
            m = re.search(r'to (' + '|'.join(roles) + r')\b', txt) or re.search(r'\[message from [^\]]+\]', txt)
        msg = e.get('message') or {}
        if e.get('type') == 'assistant' and msg.get('id') and msg.get('usage'):
            u = msg['usage']; model = msg.get('model', model)
            prev = seen.get(msg['id'], {})
            seen[msg['id']] = {k: max(prev.get(k, 0), u.get(k) or 0) for k in ('input_tokens','output_tokens','cache_read_input_tokens','cache_creation_input_tokens')}
    tot = collections.Counter()
    for v in seen.values(): tot.update(v)
    out[os.path.basename(f)] = (model, tot)
for f, (model, t) in sorted(out.items()):
    p = PRICE.get((model or '').rsplit('-2', 1)[0], None)
    usd = p and (t['input_tokens']*p[0] + t['output_tokens']*p[1] + t['cache_read_input_tokens']*p[2] + t['cache_creation_input_tokens']*p[3]) / 1e6
    print(f, model, dict(t), 'est$', round(usd, 2) if usd is not None else None)
