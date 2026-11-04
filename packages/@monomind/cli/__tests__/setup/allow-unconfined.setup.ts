// The org runtime refuses roles that run without an OS sandbox unless the
// operator opts in (--allow-unconfined / MONOMIND_ALLOW_UNCONFINED=1). Test
// orgs run fake runners on hosts that may have no bubblewrap, so the suite is
// the opt-in; tests of the refusal itself stub the variable away.
process.env.MONOMIND_ALLOW_UNCONFINED = '1';
