#!/usr/bin/env python3
"""Estimated Phase 0 spend across trials, for pre-admission checks.
Usage: budget.py <base> <trial name>... Per trial: the larger of the
meter-reported USD (bus usage events) and a transcript estimate. The
transcript estimate prices de-duplicated tokens at list rates, scaling Sonnet
by 1.85, the ratio the SDK charged over list rates on the two pilot roles with
known cost; a query cut off before its result reaches only the transcript."""
import json, glob, os, subprocess, sys
here = os.path.dirname(os.path.abspath(__file__))
SCALE = {'claude-sonnet-5': 1.85}
base, names = sys.argv[1], sys.argv[2:]
total = 0.0
for name in names:
    reported = 0.0
    for bus in glob.glob(f'{base}/trials/{name}/.monomind/orgs/{name}/run-*/bus.jsonl'):
        for l in open(bus):
            if '"usage"' in l:
                try: reported += (json.loads(l).get('data') or {}).get('cost_usd') or 0
                except Exception: pass
    est = 0.0
    out = subprocess.run([sys.executable, f'{here}/transcript-cost.py', name], capture_output=True, text=True).stdout
    for line in out.splitlines():
        parts = line.split()
        model = parts[1] if len(parts) > 1 else ''
        usd = line.rsplit('est$', 1)[-1].strip()
        if usd not in ('', 'None'): est += float(usd) * SCALE.get(model, 1.0)
    spent = max(reported, est)
    total += spent
    print(f'{name}: reported ${reported:.2f}, transcript estimate ${est:.2f}, counted ${spent:.2f}', file=sys.stderr)
print(f'{total:.2f}')
