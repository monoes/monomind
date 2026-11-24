import { tmpdir } from 'node:os';
import { join } from 'node:path';

// A developer shell with a Jev provider configured (TYPESAFE_API_KEY +
// MONOMIND_JEV_HOSTED, or MONOMIND_JEV_URL) must not let a test send its
// synthetic catalogs to a real decision model: a mocked Jev that answered
// nothing once fell through to api.typesafe.ai. Clear every provider variable
// jev-picker.cjs resolveProviders reads; a test that needs a provider stubs its
// own (vi.stubEnv, or an explicit env object pointing at a fake fetch).
for (const name of [
  'MONOMIND_JEV_URL',
  'MONOMIND_JEV_API_KEY',
  'TYPESAFE_API_KEY',
  'MONOMIND_JEV_HOSTED',
]) {
  delete process.env[name];
}

// Named providers (decision-providers.json) are a second way to configure a
// provider: a developer's real project or ~/.monomind file would reach a real
// endpoint just like the variables above. Point the lookup at a file that
// does not exist (it replaces the project and user lookup entirely).
process.env.MONOMIND_DECISION_PROVIDERS_FILE = join(
  tmpdir(),
  `monomind-test-no-decision-providers-${process.pid}.json`,
);
