# Global Human-in-the-Loop Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let any role in a running org call a new `ask_human` tool to pause and ask a free-form question, show every pending question from every org in one global dashboard tab, let a human answer from there, and deliver the answer back into the waiting role's live session immediately.

**Architecture:** A human's answer is structurally identical to a cross-org message already handled by this codebase (`org_send` → `daemon.deliver()` → `broker.ts` lookup → `/api/xdeliver` → `mailbox.push()`) — this plan adds a parallel `ask_human`/`daemon.askHuman()`/`/api/answer-question` path that reuses `broker.ts`, `inbox.ts`, and `Mailbox` exactly as they work today, plus dashboard-side additions (a new global nav tab, a new `server.mjs` list+answer endpoint pair, and a small extension to the already-shipped activity-bubble code) that mirror this dashboard's existing patterns (`renderGlobalFeed`'s per-project fan-out, the `/api/org/:name/approvals/:id` endpoint's body-parsing/atomic-write/broadcast shape).

**Tech Stack:** TypeScript (`packages/@monomind/cli/src/orgrt/*.ts`, Vitest, real instances not mocks — see `__tests__/orgrt/*.test.ts`), plain hand-edited JS/HTML (`packages/@monomind/cli/dist/src/ui/dashboard.html`, `dist/src/ui/server.mjs` — no build step, no test harness for these two files).

## Global Constraints

- No new BusEvent variant beyond `'question'` (added to the closed union in `types.ts`); resolution is reported via the existing `'status'` type with `msg: 'question answered'` and a `data.questionId` correlation field — do not invent a second dedicated event type for resolution.
- `ask_human` is agent-initiated only — no policy-gated/pre-configured triggers. Do not touch `policy.ts`; `mcp__org__ask_human` is automatically exempt from `allowTools` restrictions the same way `mcp__org__org_send` is (verified: `policy.ts:80` exempts any tool name starting with `mcp__org__`).
- A human's answer is a single free-text string — no rich text, no multi-turn Q&A UI.
- Persist pending questions at `.monomind/orgs/<org>/questions.json` (an array under a `questions` key), written via the same tmp-file-then-`renameSync` atomic pattern already used in `broker.ts`'s `registerOrg()`.
- Offline-org answer delivery reuses `inbox.ts`'s existing `queueMessage`/`drainInbox` + `daemon.ts`'s existing private `autoWake()` for the direct daemon-to-daemon path (Task 4). The dashboard-side path (Task 6, `server.mjs`) cannot call either directly — it's a separate plain-JS process with no daemon instance and no ability to `import` TS modules without a build step — so it writes the identical `inbox.jsonl` line shape (`{fromQualified, toRole, subject, body, ts}`) by hand, matching `inbox.ts`'s on-disk format exactly so the existing `drainInbox()` call in `daemon.ts`'s `startOrg()` picks it up on the org's next start with zero daemon-side changes. This is the same file-format-not-code-import duplication this file already has elsewhere (e.g. the auth-token/CORS logic fixed in the prior SSE-transport task) — not a second, divergent queueing convention.
- Dashboard files (`dashboard.html`, `server.mjs`) have no test harness — verify those tasks manually against a real running org, per this project's established pattern (see the prior activity-animation feature's Task 5).
- Do not restructure `v2RenderOrgChart`'s node template — the question-bubble state reuses the *existing* single `.v2-activity-bubble` `<foreignObject>` per node (added by the prior activity-animation feature) via attribute/class toggling only, not a second DOM element.

---

### Task 1: `BusEvent` type + forwarder translation for `question`

**Files:**
- Modify: `packages/@monomind/cli/src/orgrt/types.ts:66` (the `BusEvent.type` union)
- Modify: `packages/@monomind/cli/src/orgrt/forwarder.ts` (the `translate()` switch, ~lines 113-152)
- Test: `packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts`

**Interfaces:**
- Produces: `BusEvent.type` now includes `'question'`. `translate()` maps a `question`-type `BusEvent` to `{ type: 'org:question', from, org, runId, session, domain, ts, questionId, question }` (reading `questionId`/`question` out of the event's existing `data` field).

- [ ] **Step 1: Write the failing test**

Add to `packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts`, inside the `'translates every bus event kind into the dashboard vocabulary'` test (after the existing `usage` assertion, before the test's closing `);`):

```ts
    expect(translate(mk({ type: 'question', from: 'coder', data: { questionId: 'q1', question: 'proceed with X or Y?' } })))
      .toMatchObject({ type: 'org:question', from: 'coder', questionId: 'q1', question: 'proceed with X or Y?' });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/forwarder.test.ts -t "translates every bus event kind"`
Expected: FAIL — TypeScript compile error (`'question'` is not assignable to `BusEvent['type']`) or, if that's tolerated, a runtime mismatch because `translate()`'s `default` branch produces `{ type: 'org:question', ...e, ...base }` (raw passthrough) which lacks a top-level `questionId`/`question` (they'd be nested under `data`, not spread to the top level) — either way, the assertion fails before the fix.

- [ ] **Step 3: Add `'question'` to the `BusEvent` union**

In `packages/@monomind/cli/src/orgrt/types.ts:66`, change:

```ts
  type: 'message' | 'xorg' | 'tool' | 'asset' | 'chat' | 'status' | 'audit' | 'usage';
```

to:

```ts
  type: 'message' | 'xorg' | 'tool' | 'asset' | 'chat' | 'status' | 'audit' | 'usage' | 'question';
```

- [ ] **Step 4: Add a `question` case to `translate()`**

In `packages/@monomind/cli/src/orgrt/forwarder.ts`, insert a new `case` right after the existing `case 'asset':` block (before `case 'status':`, ~line 134-135):

```ts
    case 'question': {
      const q = (e.data as { questionId?: string; question?: string } | undefined) ?? {};
      return { ...base, type: 'org:question', from: e.from, questionId: q.questionId, question: q.question };
    }
```

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/forwarder.test.ts`
Expected: PASS — all tests in the file green, output pristine (no new warnings).

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/orgrt/types.ts packages/@monomind/cli/src/orgrt/forwarder.ts packages/@monomind/cli/__tests__/orgrt/forwarder.test.ts
git commit -m "feat(orgrt): add 'question' BusEvent type and forwarder translation"
```

---

### Task 2: `ask_human` tool + role prompt update

**Files:**
- Modify: `packages/@monomind/cli/src/orgrt/session.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/session.test.ts`

**Interfaces:**
- Consumes: none new from earlier tasks (this task only touches `session.ts`; the `askHuman` callback it calls is defined in Task 3, threaded through `SessionOpts` the same way `deliver` already is).
- Produces: `SessionOpts.askHuman?: (role: string, question: string) => Promise<string>` (new **optional** field — see Step 3 note on why this is optional, not required like `deliver`). `buildRolePrompt()`'s output now also mentions `ask_human`.

- [ ] **Step 1: Write the failing test**

Add to `packages/@monomind/cli/__tests__/orgrt/session.test.ts`, inside the existing `'buildRolePrompt names the role, goal, and org_send protocol'` test, right after the existing `expect(p).toContain('boss, coder, tester');` line:

```ts
    expect(p).toContain('ask_human');
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/session.test.ts -t "buildRolePrompt names the role"`
Expected: FAIL — `expect(received).toContain(expected)` where `received` is the current prompt string (no mention of `ask_human`).

- [ ] **Step 3: Update `SessionOpts` and `buildRolePrompt`**

In `packages/@monomind/cli/src/orgrt/session.ts`, change the `SessionOpts` interface (~line 12-23) to add one new field, right after the existing `deliver: DeliverFn;` line:

```ts
  deliver: DeliverFn;
  askHuman?: (role: string, question: string) => Promise<string>;
```

This field is **optional**, unlike `deliver` — Task 3 (a separate commit) is what actually implements `daemon.askHuman()` and wires it into `daemon.ts`'s existing call to `runAgentSession(...)`. If `askHuman` were required here, the codebase would fail to type-check between this task's commit and Task 3's (daemon.ts's call site wouldn't yet supply it). Making it optional, with a graceful fallback in the tool handler (Step 4 below) when it's absent, keeps every commit in this plan independently compiling and testable.

Change `buildRolePrompt()` (~lines 25-38) to add one new line to the returned array, right after the existing `` `Roster: ${roster.join(', ')}...` `` line:

```ts
    `Roster: ${roster.join(', ')}. Address another org's agent as "<org-name>:<role-id>".`,
    `If you need a human decision, call ask_human with your question, then end your turn — you'll receive the human's answer as a new message when it arrives. Do not call ask_human for anything you can resolve yourself.`,
```

- [ ] **Step 4: Add the `ask_human` tool to the SDK MCP server**

In `packages/@monomind/cli/src/orgrt/session.ts`'s `runOneSession()` function, inside the `createSdkMcpServer({ name: 'org', ... tools: [...] })` block (~lines 68-82), add a second tool entry after the existing `org_send` tool definition:

```ts
      tool(
        'ask_human',
        'Ask a human a free-form question and pause for their answer. Use only when you genuinely need human judgment.',
        { question: z.string() },
        async (args) => {
          if (!opts.askHuman) {
            return { content: [{ type: 'text' as const, text: 'ask_human is not available in this session' }] };
          }
          const receipt = await opts.askHuman(role.id, args.question);
          return { content: [{ type: 'text' as const, text: receipt }] };
        },
      ),
```

(`opts` here is the `SessionOpts` parameter of the enclosing `runOneSession(opts: SessionOpts)` function — `opts.askHuman` is valid regardless of the fact that `runOneSession` also destructures other `opts` fields like `deliver` into local variables at its top, since `opts` itself stays in scope throughout the function body either way. The `if (!opts.askHuman)` guard is what makes the field safely optional — every existing/test caller that doesn't pass it keeps working unchanged.)

- [ ] **Step 5: Run test to verify it passes**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/session.test.ts`
Expected: PASS — all tests in the file green, with no changes needed to the file's two other existing tests (`'emits chat events...'` and `'restarts the SDK session...'`) — since `askHuman` is optional, their existing `SessionOpts` objects (which don't set it) remain valid as-is.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/src/orgrt/session.ts packages/@monomind/cli/__tests__/orgrt/session.test.ts
git commit -m "feat(orgrt): add ask_human tool and update role prompt"
```

---

### Task 3: `daemon.askHuman()` — persist question + emit event

**Files:**
- Modify: `packages/@monomind/cli/src/orgrt/daemon.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/daemon.test.ts`

**Interfaces:**
- Consumes: `SessionOpts.askHuman` (Task 2) — this task wires the daemon's real implementation into that callback slot, exactly parallel to how `deliver: (from, to, subject, body) => this.deliver(name, from, to, subject, body)` is already threaded in `startOrg()` (~line 111).
- Produces: `OrgDaemon.askHuman(org: string, role: string, question: string): Promise<string>` (public method). Persists to `.monomind/orgs/<org>/questions.json`. Emits `bus.emit({ type: 'question', from: role, data: { questionId, question } })`.

- [ ] **Step 1: Write the failing test**

Add a new test to `packages/@monomind/cli/__tests__/orgrt/daemon.test.ts`, inside the `describe('OrgDaemon', ...)` block (after the existing `'rejects delivery to unknown role...'` test):

```ts
  it('askHuman persists the question to questions.json and emits a question event', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-ask-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    const receipt = await d.askHuman('alpha', 'boss', 'ship it now or wait?');
    expect(receipt).toMatch(/question submitted|recorded/i);
    await d.stopAll();

    const questionEvents = running.busEvents().filter(e => e.type === 'question');
    expect(questionEvents).toHaveLength(1);
    expect(questionEvents[0].from).toBe('boss');
    expect((questionEvents[0].data as any).question).toBe('ship it now or wait?');
    const questionId = (questionEvents[0].data as any).questionId as string;
    expect(questionId).toBeTruthy();

    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    expect(saved.questions).toHaveLength(1);
    expect(saved.questions[0]).toMatchObject({ questionId, role: 'boss', question: 'ship it now or wait?', answer: null, answeredAt: null });
  });
```

Add `readFileSync` to this test file's existing `node:fs` import (currently `import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';`):

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/daemon.test.ts -t "askHuman persists"`
Expected: FAIL — `d.askHuman is not a function`.

- [ ] **Step 3: Implement `daemon.askHuman()`**

In `packages/@monomind/cli/src/orgrt/daemon.ts`, add `renameSync` to the existing `node:fs` import (currently `import { readFileSync, mkdirSync, writeFileSync, existsSync } from 'node:fs';`):

```ts
import { readFileSync, mkdirSync, writeFileSync, existsSync, renameSync } from 'node:fs';
```

Add a private helper and the public method, placed right after the existing `private hasOrgDef(name: string): boolean { ... }` method (~line 268):

```ts
  private questionsPath(org: string): string {
    return join(this.root, ORG_DIR, org, 'questions.json');
  }

  private readQuestions(org: string): { questions: Array<{ questionId: string; role: string; question: string; ts: number; answer: string | null; answeredAt: number | null }> } {
    try { return JSON.parse(readFileSync(this.questionsPath(org), 'utf8')); } catch { return { questions: [] }; }
  }

  private writeQuestions(org: string, data: ReturnType<OrgDaemon['readQuestions']>): void {
    const dest = this.questionsPath(org);
    mkdirSync(join(this.root, ORG_DIR, org), { recursive: true });
    const tmp = `${dest}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(data, null, 2));
    renameSync(tmp, dest);
  }

  /** Agent-initiated human question (ask_human tool). Persists to questions.json (survives
   *  process/dashboard restarts) and emits a 'question' BusEvent so the dashboard's SSE
   *  stream and global inbox pick it up in real time. Returns a receipt string for the tool call. */
  async askHuman(org: string, role: string, question: string): Promise<string> {
    const running = this.orgs.get(org);
    const questionId = `q-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    const data = this.readQuestions(org);
    data.questions.push({ questionId, role, question, ts: Date.now(), answer: null, answeredAt: null });
    this.writeQuestions(org, data);
    running?.bus.emit({ type: 'question', from: role, data: { questionId, question } });
    return `Question recorded (id ${questionId}) — a human will answer it; you'll receive the answer as a new message.`;
  }
```

Wire it into `startOrg()`'s `runAgentSession(...)` call (~line 108-112), adding one line after the existing `deliver:` line:

```ts
        deliver: (from, to, subject, body) => this.deliver(name, from, to, subject, body),
        askHuman: (role, question) => this.askHuman(name, role, question),
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/daemon.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/orgrt/daemon.ts packages/@monomind/cli/__tests__/orgrt/daemon.test.ts
git commit -m "feat(orgrt): add daemon.askHuman() — persist question, emit event"
```

---

### Task 4: `daemon.answerQuestion()` — deliver answer, running and offline

**Files:**
- Modify: `packages/@monomind/cli/src/orgrt/daemon.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/daemon.test.ts`

**Interfaces:**
- Consumes: `readQuestions`/`writeQuestions`/`questionsPath` (Task 3, private helpers on the same class). `queueMessage`, `this.autoWake` (existing, already imported/defined).
- Produces: `OrgDaemon.answerQuestion(org: string, role: string, questionId: string, answer: string): Promise<{ ok: true } | { ok: false; error: string }>` (public method).

- [ ] **Step 1: Write the failing tests**

Add two new tests to `packages/@monomind/cli/__tests__/orgrt/daemon.test.ts`, right after the `'askHuman persists...'` test from Task 3:

```ts
  it('answerQuestion delivers into a running role\'s live mailbox and marks the question answered', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-answer-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    await d.askHuman('alpha', 'coder', 'red or blue?');
    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    const questionId = saved.questions[0].questionId;

    const result = await d.answerQuestion('alpha', 'coder', questionId, 'blue');
    expect(result.ok).toBe(true);
    await new Promise(r => setTimeout(r, 50)); // let the echo session process the pushed mailbox message
    await d.stopAll();

    expect(running.busEvents().some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('blue'))).toBe(true);
    const savedAfter = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    expect(savedAfter.questions[0].answer).toBe('blue');
    expect(savedAfter.questions[0].answeredAt).toBeTypeOf('number');
  });

  it('answerQuestion queues the answer and auto-wakes an offline org', async () => {
    const root = mkdtempSync(join(tmpdir(), 'daemon-answer-offline-'));
    fixture(root, 'alpha');
    const d = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const running = await d.startOrg('alpha');
    await d.askHuman('alpha', 'coder', 'red or blue?');
    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    const questionId = saved.questions[0].questionId;
    await d.stopOrg('alpha'); // org now offline

    const result = await d.answerQuestion('alpha', 'coder', questionId, 'blue');
    expect(result.ok).toBe(true);
    await new Promise(r => setTimeout(r, 100)); // let autoWake's startOrg + drainInbox + echo session settle
    const restarted = d.getOrg('alpha');
    expect(restarted).toBeDefined();
    expect(restarted!.busEvents().some(e => e.type === 'chat' && e.from === 'coder' && (e.msg ?? '').includes('blue'))).toBe(true);
    await d.stopAll();
  });
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/daemon.test.ts -t "answerQuestion"`
Expected: FAIL — `d.answerQuestion is not a function`.

- [ ] **Step 3: Implement `daemon.answerQuestion()`**

In `packages/@monomind/cli/src/orgrt/daemon.ts`, add this public method right after `askHuman()` from Task 3:

```ts
  /** Delivers a human's answer to a pending ask_human question. If the org is still
   *  running, pushes straight into the role's live mailbox (picked up on its very next
   *  generator tick — see Mailbox.stream()). If the org has since stopped, queues the
   *  answer via the same offline fallback deliver()/receiveRemote() already use
   *  (inbox.ts + autoWake) and it's delivered when the org next starts. */
  async answerQuestion(org: string, role: string, questionId: string, answer: string): Promise<{ ok: true } | { ok: false; error: string }> {
    const data = this.readQuestions(org);
    const idx = data.questions.findIndex(q => q.questionId === questionId);
    if (idx === -1) return { ok: false, error: `question "${questionId}" not found for org "${org}"` };
    if (data.questions[idx].answer !== null) return { ok: false, error: `question "${questionId}" already answered` };
    data.questions[idx] = { ...data.questions[idx], answer, answeredAt: Date.now() };
    this.writeQuestions(org, data);

    const running = this.orgs.get(org);
    if (running) {
      // Org IS running — deliver or report a real error, but never fall through to the
      // offline queue+autoWake path below: autoWake() no-ops when this.orgs already has
      // the org (see its own guard), so a role-specific delivery failure here (mailbox
      // closed, role unknown) would otherwise queue the answer forever with no real error
      // and no delivery. Mirrors deliver()'s existing "shutting down" error for the same
      // mid-shutdown-mailbox-closed race.
      const agent = running.agents.get(role);
      if (!agent) return { ok: false, error: `role "${role}" not found in org "${org}"` };
      if (agent.mailbox.isClosed) return { ok: false, error: `role "${role}" in org "${org}" is shutting down — answer not delivered` };
      running.bus.emit({ type: 'status', from: role, msg: 'question answered', data: { questionId } });
      agent.mailbox.push(`[answer from human] question: ${data.questions[idx].question}\n\nanswer: ${answer}`);
      return { ok: true };
    }
    // Org not running at all — queue for delivery on next start, matching deliver()'s
    // existing offline fallback exactly (inbox.ts + autoWake).
    if (!this.hasOrgDef(org)) return { ok: false, error: `org "${org}" not found (no saved definition)` };
    queueMessage(this.root, org, {
      fromQualified: 'human', toRole: role,
      subject: `answer:${questionId}`, body: answer, ts: Date.now(),
    });
    this.autoWake(org);
    return { ok: true };
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/daemon.test.ts`
Expected: PASS — all tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/orgrt/daemon.ts packages/@monomind/cli/__tests__/orgrt/daemon.test.ts
git commit -m "feat(orgrt): add daemon.answerQuestion() — live delivery + offline fallback"
```

---

### Task 5: `POST /api/answer-question` on the org's own xdeliver-style server

**Files:**
- Modify: `packages/@monomind/cli/src/orgrt/server.ts`
- Test: `packages/@monomind/cli/__tests__/orgrt/server.test.ts`

**Interfaces:**
- Consumes: `daemon.answerQuestion()` (Task 4).
- Produces: a new route on the existing `startOrgServer(daemon, port)` HTTP server: `POST /api/answer-question`, body `{ org, role, questionId, answer }`, response `{ ok: true }` (200) or `{ ok: false, error }` (400/404).

- [ ] **Step 1: Write the failing test**

Add to `packages/@monomind/cli/__tests__/orgrt/server.test.ts`, as a new test inside the existing `describe('org xdeliver server', ...)` block:

```ts
  it('accepts POST /api/answer-question and delivers into the role\'s mailbox', async () => {
    const root = mkdtempSync(join(tmpdir(), 'srv-answer-'));
    mkdirSync(join(root, '.monomind/orgs'), { recursive: true });
    writeFileSync(join(root, '.monomind/orgs/alpha.json'), JSON.stringify({
      name: 'alpha', goal: 'g',
      roles: [{ id: 'boss', title: 'B', type: 'boss', reports_to: null }],
    }));
    const daemon = new OrgDaemon(root, { queryFn: echoQuery as any, forward: false });
    const srv = await startOrgServer(daemon, 0);
    close = srv.close;
    await daemon.startOrg('alpha');
    await daemon.askHuman('alpha', 'boss', 'proceed?');
    const saved = JSON.parse(readFileSync(join(root, '.monomind/orgs/alpha/questions.json'), 'utf8'));
    const questionId = saved.questions[0].questionId;

    // missing fields → 400
    const bad = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: 'alpha' }),
    });
    expect(bad.status).toBe(400);

    // valid answer → 200
    const good = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: 'alpha', role: 'boss', questionId, answer: 'yes' }),
    });
    expect(good.status).toBe(200);
    const data = await good.json() as { ok: boolean };
    expect(data.ok).toBe(true);

    // unknown question id → 404
    const miss = await fetch(`http://127.0.0.1:${srv.port}/api/answer-question`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ org: 'alpha', role: 'boss', questionId: 'nope', answer: 'yes' }),
    });
    expect(miss.status).toBe(404);

    await daemon.stopAll();
  });
```

Add `readFileSync` to this test file's existing `node:fs` import (currently `import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';`):

```ts
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/server.test.ts -t "answer-question"`
Expected: FAIL — the new route doesn't exist yet, so the server's fallback `else { res.writeHead(404); ... }` fires for every request, and the "valid answer → 200" assertion fails (gets 404 instead).

- [ ] **Step 3: Implement the route**

In `packages/@monomind/cli/src/orgrt/server.ts`, inside the `http.createServer((req, res) => { ... })` callback, add a second `if` block right after the existing `/api/xdeliver` block's closing `}` (before the `else { res.writeHead(404); ... }`):

```ts
    if (req.method === 'POST' && req.url === '/api/answer-question') {
      let body = '';
      req.on('data', c => { body += c; });
      req.on('end', () => {
        (async () => {
          try {
            const payload = JSON.parse(body || '{}') as {
              org?: string; role?: string; questionId?: string; answer?: string;
            };
            if (!payload.org || !payload.role || !payload.questionId || payload.answer === undefined) {
              res.writeHead(400, { 'Content-Type': 'application/json' });
              res.end(JSON.stringify({ ok: false, error: 'org, role, questionId, answer are required' }));
              return;
            }
            const result = await daemon.answerQuestion(payload.org, payload.role, payload.questionId, payload.answer);
            res.writeHead(result.ok ? 200 : 404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify(result));
          } catch (err) {
            res.writeHead(400, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: err instanceof Error ? err.message : 'bad request' }));
          }
        })();
      });
      return;
    }
```

Note the route dispatcher in this file is a plain (non-async) `http.createServer((req, res) => {...})` callback (confirm this against the existing `/api/xdeliver` block, which is also synchronous at the top level) — the new block wraps its body in an inner `async () => {...}` IIFE since `daemon.answerQuestion()` is async and `req.on('end', ...)` callbacks can't themselves be `async` without an unhandled-rejection risk.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd packages/@monomind/cli && npx vitest run __tests__/orgrt/server.test.ts`
Expected: PASS — both tests in the file green.

- [ ] **Step 5: Commit**

```bash
git add packages/@monomind/cli/src/orgrt/server.ts packages/@monomind/cli/__tests__/orgrt/server.test.ts
git commit -m "feat(orgrt): add POST /api/answer-question to the org xdeliver server"
```

---

### Task 6: `server.mjs` — list pending questions + forward an answer

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/server.mjs`

**Interfaces:**
- Consumes: `broker.ts`'s file-based registry at `~/.monomind/orgrt-broker/<org>.json` (read directly — `server.mjs` is a separate process from any org daemon, so it reads the SAME broker file each org daemon writes via `BrokerLease`/`registerOrg()`, no code sharing needed, just replicate the tiny read: `JSON.parse(readFileSync(...))` with the same staleness check `broker.ts`'s `lookupOrg()` uses).
- Produces: `GET /api/questions?dir=<projectDir>` — scans `<dir>/.monomind/orgs/*/questions.json`, returns `{ questions: [{ org, questionId, role, question, ts }] }` for every *unanswered* question in that one project (mirrors the `.monomind/orgs/*-approvals.json` per-org sidecar convention already used by the existing approvals endpoints, but reads the new per-org-directory `questions.json` files this feature's daemon side writes). `POST /api/questions/answer` — body `{ dir, org, role, questionId, answer }` — looks up the org's live process via the broker registry and forwards to `/api/answer-question` on that process; broadcasts an `org:question-answered` event via `broadcastMm()` on success so every connected dashboard removes the row live.

  Deliberate simplification vs. the design spec's stated "in-memory index rebuilt from the SSE/event-log": a live per-project directory scan on each `GET` (a handful of small local JSON files) is simpler, has no cache-invalidation/rebuild-on-restart logic to get wrong, and matches the actual existing precedent found during implementation research (`GET /api/mastermind/sessions`'s live per-project scan, not a maintained in-memory cache) — the spec's goal ("fast, correct global-inbox rendering") is met either way; this task implements it the simpler way.

- [ ] **Step 1: Add the list endpoint**

In `packages/@monomind/cli/dist/src/ui/server.mjs`, inside the main `http.createServer(async (req, res) => {...})` dispatcher, add this block near the other `GET /api/org/...`-style routes (e.g. right before the existing `POST /api/org/:name/approvals/:id` block found at server.mjs:4743):

```js
    // GET /api/questions?dir=<projectDir> — list unanswered ask_human questions for
    // every org in one project. Mirrors the existing -approvals.json sidecar convention,
    // but reads this feature's .monomind/orgs/<org>/questions.json files (one per org dir).
    if (req.method === 'GET' && url === '/api/questions') {
      try {
        const _qDir = new URL(req.url, 'http://localhost').searchParams.get('dir') || projectDir || process.cwd();
        const base = path.join(path.resolve(_qDir), '.monomind', 'orgs');
        const out = [];
        if (fs.existsSync(base)) {
          for (const orgName of fs.readdirSync(base)) {
            const qFile = path.join(base, orgName, 'questions.json');
            if (!fs.existsSync(qFile)) continue;
            let data = { questions: [] };
            try { data = JSON.parse(fs.readFileSync(qFile, 'utf8')); } catch (_) {}
            for (const q of (data.questions || [])) {
              if (q.answer === null || q.answer === undefined) out.push({ org: orgName, ...q });
            }
          }
        }
        res.writeHead(200, { 'Content-Type': 'application/json', ...(corsOrigin ? { 'Access-Control-Allow-Origin': corsOrigin } : {}) });
        res.end(JSON.stringify({ questions: out }));
      } catch (_e) { res.writeHead(500); res.end('{"questions":[]}'); }
      return;
    }
```

- [ ] **Step 2: Add the answer-forwarding endpoint**

Add this block right after the one from Step 1:

```js
    // POST /api/questions/answer — forward a human's answer to the org's live process
    // (looked up via the same file-based broker registry orgrt's cross-process delivery
    // already uses), or fail with a clear error if no process anywhere hosts it.
    if (req.method === 'POST' && url === '/api/questions/answer') {
      let body = '';
      for await (const chunk of req) { body += chunk; if (body.length > 2097152) { req.destroy(); break; } }
      try {
        const parsed = JSON.parse(body);
        const { dir, org, role, questionId, answer } = parsed;
        if (!org || !role || !questionId || answer === undefined) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: 'org, role, questionId, answer are required' }));
          return;
        }
        const brokerDir = path.join(os.homedir(), '.monomind', 'orgrt-broker');
        const entryPath = path.join(brokerDir, `${org}.json`);
        let hostUrl = null;
        try {
          const entry = JSON.parse(fs.readFileSync(entryPath, 'utf8'));
          if (Date.now() - entry.updatedAt < 90000) hostUrl = entry.url;
        } catch (_) {}
        if (!hostUrl) {
          // No live process to forward to — the control server has no daemon instance of
          // its own to call autoWake() on. If the org's definition still exists on disk,
          // queue the answer the same way inbox.ts's queueMessage()/drainInbox() already
          // do for offline cross-org messages, so it's delivered whenever the org next
          // starts (manually or via its own schedule) — matching the offline-delivery goal
          // for the dashboard path, not just the direct-daemon path Task 4 already covers.
          const projDir = path.resolve(dir || projectDir || process.cwd());
          const orgDefFile = path.join(projDir, '.monomind', 'orgs', `${org}.json`);
          if (!fs.existsSync(orgDefFile)) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `org "${org}" not found — no running process and no saved definition` }));
            return;
          }
          const qFile = path.join(projDir, '.monomind', 'orgs', org, 'questions.json');
          let qData = { questions: [] };
          try { qData = JSON.parse(fs.readFileSync(qFile, 'utf8')); } catch (_) {}
          const qIdx = (qData.questions || []).findIndex(q => q.questionId === questionId);
          if (qIdx === -1) {
            res.writeHead(404, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: false, error: `question "${questionId}" not found for org "${org}"` }));
            return;
          }
          if (qData.questions[qIdx].answer !== null && qData.questions[qIdx].answer !== undefined) {
            res.writeHead(200, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ ok: true, alreadyAnswered: true }));
            return;
          }
          qData.questions[qIdx] = { ...qData.questions[qIdx], answer, answeredAt: Date.now() };
          const qTmp = `${qFile}.tmp`;
          fs.writeFileSync(qTmp, JSON.stringify(qData, null, 2));
          fs.renameSync(qTmp, qFile);
          const inboxDir = path.join(projDir, '.monomind', 'orgs', org);
          fs.mkdirSync(inboxDir, { recursive: true });
          fs.appendFileSync(path.join(inboxDir, 'inbox.jsonl'), JSON.stringify({
            fromQualified: 'human', toRole: role, subject: `answer:${questionId}`, body: answer, ts: Date.now(),
          }) + '\n');
          const queuedEvent = { type: 'org:question-answered', org, role, questionId, ts: Date.now(), queued: true };
          appendToFile(path.join(projDir, 'data', 'mastermind-events.jsonl'), JSON.stringify(queuedEvent) + '\n').catch(() => {});
          broadcastMm(queuedEvent);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true, queued: true }));
          return;
        }
        const fwd = await fetch(`${hostUrl}/api/answer-question`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ org, role, questionId, answer }),
          signal: AbortSignal.timeout(5000),
        });
        const fwdData = await fwd.json().catch(() => ({}));
        if (fwd.ok && fwdData.ok) {
          const event = { type: 'org:question-answered', org, role, questionId, ts: Date.now() };
          appendToFile(path.join(path.resolve(dir || projectDir || process.cwd()), 'data', 'mastermind-events.jsonl'), JSON.stringify(event) + '\n').catch(() => {});
          broadcastMm(event);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: true }));
        } else {
          res.writeHead(fwd.status || 500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ ok: false, error: fwdData.error || 'answer delivery failed' }));
        }
      } catch (_e) { res.writeHead(500); res.end('{"ok":false}'); }
      return;
    }
```

- [ ] **Step 3: Verify `os` is imported**

Grep the top of `server.mjs` for `require('node:os')` or `import os from 'node:os'` (the file already uses `os.tmpdir()` elsewhere per prior work in this codebase) — confirm the import exists; if not, add it alongside the other top-of-file imports (`fs`, `path`, `http`, `crypto`).

- [ ] **Step 4: Verify syntax**

Run: `node --check packages/@monomind/cli/dist/src/ui/server.mjs`
Expected: no output (valid syntax).

- [ ] **Step 5: Manual verification**

There is no test harness for this file. Start it in a scratch directory (following the same pattern used to verify the SSE-transport fix earlier in this project): run `node packages/@monomind/cli/dist/src/ui/server.mjs <port>` from an empty scratch dir, create a fake `.monomind/orgs/testorg/questions.json` with one unanswered question by hand, then `curl "http://localhost:<port>/api/questions?dir=<scratch-dir>"` and confirm the question appears in the response. Confirm `curl -X POST .../api/questions/answer` with no matching broker entry AND no `.monomind/orgs/testorg.json` def file returns a 404 error. Then create a fake `.monomind/orgs/testorg.json` def file (any valid-looking org JSON) and repeat the answer POST — confirm it now returns `{ok:true, queued:true}`, the question's `answer`/`answeredAt` fields are set in `questions.json`, and a new line was appended to `.monomind/orgs/testorg/inbox.jsonl` in the `{fromQualified, toRole, subject, body, ts}` shape.

- [ ] **Step 6: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "feat(dashboard): add /api/questions list + answer-forwarding endpoints"
```

---

### Task 7: Dashboard — global "Human Input" tab

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard.html`

**Interfaces:**
- Consumes: `GET /api/questions?dir=...` (Task 6), `POST /api/questions/answer` (Task 6), existing `apiFetch`, `enc`, `esc`, `relTime`, `showToast` helpers (already used by `renderGlobalFeed`/`orgApprovalAction`), existing `/api/projects` endpoint (already used by `renderGlobalFeed`).
- Produces: a new global nav tab `data-view="humaninput"`, view container `#view-humaninput`, and `renderHumanInputView()` function registered in `renderView()`'s dispatch.

- [ ] **Step 1: Add the nav item**

In `packages/@monomind/cli/dist/src/ui/dashboard.html`, in the bottom `<div class="nav-sect" style="margin-top:auto;padding-top:8px;">` block (~lines 1592-1610), add a new nav item right after the existing `chat` one (before the closing `</div>` of that section, ~line 1610):

```html
      <div class="nav-item" data-view="humaninput" title="Pending questions from agents across all orgs">
        <span class="ico">❓</span><span class="lbl">Human Input</span>
        <span class="bdg" id="bdg-humaninput">—</span>
      </div>
```

- [ ] **Step 2: Add the view container**

Right after the existing `<div class="view" id="view-chat">...</div>` block (locate its closing `</div>` — the block starts at ~line 2322), add a new sibling view, mirroring the exact structure of `view-global` (~lines 2290-2298):

```html
    <!-- HUMAN INPUT (global, cross-org) -->
    <div class="view" id="view-humaninput">
      <div class="vscroll">
        <div style="display:flex;align-items:baseline;gap:10px;margin-bottom:4px">
          <div class="pg-title" style="margin-bottom:0">Human Input</div>
          <span class="pg-sub" id="hi-sub" style="margin-bottom:0">Pending questions across all projects</span>
        </div>
        <div id="hi-content" style="margin-top:16px"><div class="loading-txt">Loading…</div></div>
      </div>
    </div>
```

- [ ] **Step 3: Register the view in `switchView`/`renderView`**

In `packages/@monomind/cli/dist/src/ui/dashboard.html`'s `switchView()` function (~line 2480), add `'humaninput':'Human Input'` to the `titles` object literal:

```js
  const titles = { now:'Now', projects:'Projects', sessions:'Sessions', loops:'Loops', tokens:'Tokens', memory:'Memory', orgs:'Orgs', monograph:'Monograph', monoagent:'MonoAgent', global:'Global Feed', 'global-loops':'Global Loops', 'global-tokens':'Global Tokens', chat:'Global Agent Chat', humaninput:'Human Input' };
```

And to the `VIEW_LABELS` object literal (~line 2483):

```js
  const VIEW_LABELS = { now: 'Now', sessions: 'Sessions', projects: 'Projects', loops: 'Loops', tokens: 'Tokens', memory: 'Memory', orgs: 'Orgs', monograph: 'Monograph', monoagent: 'MonoAgent', global: 'Global Feed', 'global-loops': 'Global Loops', 'global-tokens': 'Global Tokens', chat: 'Global Agent Chat', humaninput: 'Human Input' };
```

In `renderView(v)` (~lines 2534-2547), add one line:

```js
  if (v === 'humaninput') renderHumanInputView();
```

- [ ] **Step 4: Implement `renderHumanInputView()`**

Add this function right after the existing `renderGlobalFeed()` function (whose closing `}` is a few lines after dashboard.html:4135 — locate it by finding the next top-level `function` declaration after `renderGlobalFeed`), mirroring its exact per-project fan-out pattern:

```js
async function renderHumanInputView() {
  const el = document.getElementById('hi-content');
  el.innerHTML = '<div class="loading-txt">Loading all projects…</div>';
  try {
    const data = await apiFetch('/api/projects');
    const projects = (data?.projects || []).slice(0, 8);
    if (!projects.length) {
      el.innerHTML = '<div class="empty"><div class="empty-ico">❓</div><div>No projects found</div></div>';
      updateHumanInputBadge(0);
      return;
    }
    const results = await Promise.allSettled(
      projects.map(p => apiFetch('/api/questions?dir=' + enc(p.path)).then(d => ({ project: p, questions: d.questions || [] })))
    );
    const entries = [];
    for (const r of results) {
      if (r.status !== 'fulfilled') continue;
      const { project, questions } = r.value;
      for (const q of questions) entries.push({ project, q });
    }
    entries.sort((a, b) => (b.q.ts || 0) - (a.q.ts || 0));
    updateHumanInputBadge(entries.length);
    document.getElementById('hi-sub').textContent = entries.length
      ? `${entries.length} pending question(s) across ${projects.length} projects`
      : `No pending questions across ${projects.length} projects`;
    if (!entries.length) {
      el.innerHTML = '<div class="empty"><div class="empty-ico">❓</div><div>No pending questions</div></div>';
      return;
    }
    el.innerHTML = '<div class="sess-list">' + entries.map(({ project, q }) => `
      <div class="sess-row" data-question-id="${esc(q.questionId)}" style="flex-direction:column;align-items:stretch;gap:6px">
        <div style="display:flex;justify-content:space-between;gap:8px">
          <div><b>${esc(q.org)}</b> · ${esc(q.role)} <span style="color:var(--text-xs)">(${esc(project.name || project.path)})</span></div>
          <div style="color:var(--text-xs);font-size:11px;font-family:var(--mono)">${relTime(q.ts)}</div>
        </div>
        <div style="color:var(--text-hi)">${esc(q.question)}</div>
        <div style="display:flex;gap:6px">
          <input type="text" class="hi-answer-input" placeholder="Your answer…" style="flex:1;padding:4px 8px;font-size:12px" />
          <button class="btn" style="font-size:11px" onclick="submitHumanAnswer('${esc(project.path)}','${esc(q.org)}','${esc(q.role)}','${esc(q.questionId)}',this)">Answer</button>
        </div>
      </div>
    `).join('') + '</div>';
  } catch (e) { el.innerHTML = '<div class="empty">Failed: ' + esc(e.message) + '</div>'; }
}

function updateHumanInputBadge(count) {
  const b = document.getElementById('bdg-humaninput');
  if (b) b.textContent = String(count);
}

async function submitHumanAnswer(dir, org, role, questionId, btnEl) {
  const row = btnEl.closest('[data-question-id]');
  const input = row.querySelector('.hi-answer-input');
  const answer = input.value.trim();
  if (!answer) return;
  btnEl.disabled = true;
  try {
    const res = await fetch('/api/questions/answer', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ dir, org, role, questionId, answer }),
    });
    const data = await res.json();
    if (data.ok) { showToast('Answered', `${org}:${role}`, 'ok'); row.remove(); }
    else { showToast('Error', data.error || 'failed', 'err'); btnEl.disabled = false; }
  } catch (e) { showToast('Error', e.message, 'err'); btnEl.disabled = false; }
}
```

- [ ] **Step 5: Verify syntax**

Extract the inline `<script>` block content and check it with `node --check`:

```bash
node -e "
const fs = require('fs');
const html = fs.readFileSync('packages/@monomind/cli/dist/src/ui/dashboard.html', 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
fs.writeFileSync('/tmp/dash-check.js', m[1]);
"
node --check /tmp/dash-check.js
```

Expected: no output (valid syntax).

- [ ] **Step 6: Manual verification**

Per this project's established pattern for this file: invoke the `agent-browser-testing` skill and use `monomind browse` to open the dashboard, click the new "Human Input" nav item, confirm the view renders (empty state if no questions exist yet — full end-to-end with a real question is verified in Task 9).

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard.html
git commit -m "feat(dashboard): add global Human Input tab (list + answer)"
```

---

### Task 8: Dashboard — live SSE wiring + chart question-bubble state

**Files:**
- Modify: `packages/@monomind/cli/dist/src/ui/dashboard.html`

**Interfaces:**
- Consumes: `_odtHandleLiveEvent(ev)` (existing, ~line 8322), `v2ShowActivityBubble`/`_v2BubbleTimers` (existing, from the prior activity-animation feature), `renderHumanInputView`/`updateHumanInputBadge` (Task 7).
- Produces: `v2ShowQuestionBubble(roleId, questionText)`, `v2ClearQuestionBubble(roleId)`, a small refactor extracting `_v2FadeOutBubble(fo)` out of the existing idle-timeout logic in `v2ShowActivityBubble` for reuse by both.

- [ ] **Step 1: Extract `_v2FadeOutBubble` from the existing idle-timeout logic**

In `packages/@monomind/cli/dist/src/ui/dashboard.html`, find `v2ShowActivityBubble` (added by the prior activity-animation feature). Its idle-timeout callback currently contains inline GSAP fade-out code resembling:

```js
  const existing = _v2BubbleTimers.get(roleId);
  if (existing) clearTimeout(existing);
  _v2BubbleTimers.set(roleId, setTimeout(function() {
    if (typeof gsap !== 'undefined') {
      gsap.to(fo, { autoAlpha: 0, duration: 0.4, ease: 'power2.in', onComplete: function() { fo.style.visibility = 'hidden'; } });
    } else {
      fo.style.opacity = '0';
      fo.style.visibility = 'hidden';
    }
    _v2BubbleTimers.delete(roleId);
  }, 5000));
```

Extract the fade-out body into a standalone function placed right before `v2ShowActivityBubble`:

```js
function _v2FadeOutBubble(fo) {
  if (typeof gsap !== 'undefined') {
    gsap.to(fo, { autoAlpha: 0, duration: 0.4, ease: 'power2.in', onComplete: function() { fo.style.visibility = 'hidden'; } });
  } else {
    fo.style.opacity = '0';
    fo.style.visibility = 'hidden';
  }
}
```

Then update `v2ShowActivityBubble`'s idle-timeout callback to call it, and to skip scheduling entirely if a question is pending for this role (so a normal status event can't fade out a question bubble):

```js
function v2ShowActivityBubble(roleId, text) {
  const fo = document.querySelector('.v2-activity-bubble[data-bubble-for="' + CSS.escape(roleId) + '"]');
  if (!fo) return;
  if (fo.dataset.questionPending === '1') return; // a pending question owns this bubble until answered
  const inner = fo.querySelector('.v2-bubble-inner');
  inner.textContent = text;
  if (typeof gsap !== 'undefined') {
    gsap.killTweensOf(fo);
    fo.style.visibility = 'visible';
    gsap.fromTo(fo, { scale: 0.8, autoAlpha: 0 }, {
      scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.7)',
      transformOrigin: '50% 100%',
    });
  } else {
    fo.style.visibility = 'visible';
    fo.style.opacity = '1';
  }
  const existing = _v2BubbleTimers.get(roleId);
  if (existing) clearTimeout(existing);
  _v2BubbleTimers.set(roleId, setTimeout(function() {
    _v2FadeOutBubble(fo);
    _v2BubbleTimers.delete(roleId);
  }, 5000));
}
```

(The only changes from the existing implementation: the new `data-question-pending` guard at the top, and the timeout body calling the extracted `_v2FadeOutBubble(fo)` instead of inlining the GSAP tween.)

- [ ] **Step 2: Add `v2ShowQuestionBubble` and `v2ClearQuestionBubble`**

Add these two functions right after `v2ShowActivityBubble`:

```js
function v2ShowQuestionBubble(roleId, questionText) {
  const fo = document.querySelector('.v2-activity-bubble[data-bubble-for="' + CSS.escape(roleId) + '"]');
  if (!fo) return;
  const existing = _v2BubbleTimers.get(roleId);
  if (existing) { clearTimeout(existing); _v2BubbleTimers.delete(roleId); }
  fo.dataset.questionPending = '1';
  const inner = fo.querySelector('.v2-bubble-inner');
  inner.textContent = '❓ ' + (questionText.length > 40 ? questionText.slice(0, 39) + '…' : questionText);
  inner.classList.add('v2-bubble-question');
  if (typeof gsap !== 'undefined') {
    gsap.killTweensOf(fo);
    fo.style.visibility = 'visible';
    gsap.fromTo(fo, { scale: 0.8, autoAlpha: 0 }, { scale: 1, autoAlpha: 1, duration: 0.3, ease: 'back.out(1.7)', transformOrigin: '50% 100%' });
  } else {
    fo.style.visibility = 'visible';
    fo.style.opacity = '1';
  }
}

function v2ClearQuestionBubble(roleId) {
  const fo = document.querySelector('.v2-activity-bubble[data-bubble-for="' + CSS.escape(roleId) + '"]');
  if (!fo) return;
  delete fo.dataset.questionPending;
  const inner = fo.querySelector('.v2-bubble-inner');
  if (inner) inner.classList.remove('v2-bubble-question');
  _v2FadeOutBubble(fo);
}
```

- [ ] **Step 3: Add the amber question-bubble CSS**

Near the existing `.v2-bubble-inner` rule (added by the prior activity-animation feature, ~line 430 area), add:

```css
.v2-bubble-inner.v2-bubble-question {
  background: oklch(28% 0.04 75 / 0.95);
  border-color: oklch(78% 0.16 75 / 0.7);
  color: oklch(92% 0.03 75);
}
```

- [ ] **Step 4: Wire `org:question`/`org:question-answered` into `_odtHandleLiveEvent`**

In `_odtHandleLiveEvent(ev)` (~line 8322), add a branch that fires for ALL orgs (not just the currently-selected one), placed before the existing `if (ev && ev.org === _v2SelOrg) {...}` block (~line 8335) — this ordering matters because that block only applies to the selected org and would otherwise silently swallow cross-org question events:

```js
  if (ev?.type === 'org:question' && ev.from) {
    v2ShowQuestionBubble(ev.from, ev.question || '');
    if (viewRendered['humaninput']) renderHumanInputView();
    else updateHumanInputBadge((parseInt(document.getElementById('bdg-humaninput')?.textContent, 10) || 0) + 1);
  }
  if (ev?.type === 'org:question-answered' && ev.role) {
    v2ClearQuestionBubble(ev.role);
  }
```

(Place this immediately after the existing dedup-bookkeeping block, the same insertion point the prior activity-animation feature used for its own `_odtHandleLiveEvent` addition — before the `ev?.org && ev?.runId` routing block.)

Note: `org:question`'s payload has a `from` field (Task 1's forwarder sets it from the BusEvent's own `from`), but `org:question-answered`'s payload (emitted by `server.mjs` in Task 6) has no `from` field at all — only `org`/`role`/`questionId`/`ts` — so the second branch above keys off `ev.role`, not `ev.from`.

- [ ] **Step 5: Verify syntax**

Repeat the same `node --check` extraction from Task 7 Step 5.

- [ ] **Step 6: Manual verification**

Deferred to Task 9's full end-to-end pass (this task's pieces only become observable together with a real `ask_human` call).

- [ ] **Step 7: Commit**

```bash
git add packages/@monomind/cli/dist/src/ui/dashboard.html packages/@monomind/cli/dist/src/ui/server.mjs
git commit -m "feat(dashboard): wire live question events into chart bubble + global inbox"
```

---

### Task 9: Full end-to-end pass against a real running org

**Files:** None modified — verification only.

- [ ] **Step 1: Run a real org whose goal naturally prompts a human question**

Reuse or adapt the existing `.monomind/orgs/sample-team.json` fixture (used for the prior feature's Task 5), or create a small 2-role org whose boss role's goal explicitly instructs it to call `ask_human` once (e.g. "Before writing the haiku, ask a human whether it should rhyme or not, then proceed based on the answer.").

- [ ] **Step 2: Observe via `agent-browser-testing` / `monomind browse`**

Per this package's mandatory rule, invoke the `agent-browser-testing` skill first. With the org running and the dashboard open:
- Confirm the role's node in the org chart shows the amber question bubble with the question text, and that it does NOT fade after 5s.
- Confirm the "Human Input" nav badge increments and the question appears in the global inbox with correct org/role/question/project.
- Submit an answer from the global inbox; confirm the row disappears, the chart bubble clears, and the role's session actually resumes and acts on the answer (visible in its chat feed).
- Stop the org, submit an answer to a second pending question (create one first via a fresh run) while it's offline; confirm the dashboard reports it as queued (not an error), that the question is marked answered and removed from the global inbox immediately, and that restarting the org manually delivers the answer as the role's first message (this dashboard-driven offline path queues via `inbox.jsonl` and waits for a real restart — it does not auto-wake the org itself, since `server.mjs` has no daemon instance to call `autoWake()` on; that immediate-auto-wake behavior only applies to the direct daemon-to-daemon path already covered by Task 4's own tests).
- Confirm no console errors were introduced.

- [ ] **Step 3: Report results**

Summarize pass/fail per bullet above. If any bullet fails, return to the relevant task and fix before considering the feature complete.
