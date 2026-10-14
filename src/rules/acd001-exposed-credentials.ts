import { CONFIG_KINDS } from '../types/index.js';
import { findSecrets, redactSecret } from '../util/secrets.js';
import { shortHash } from '../util/text.js';
import { findingFor, type Rule } from './types.js';

export const exposedCredentials: Rule = {
  id: 'ACD001',
  name: 'exposed-credentials',
  title: 'Potential exposed credential',
  severity: 'critical',
  description:
    'Detects strings that match well-known credential formats (cloud, VCS, AI provider, payment and chat tokens, private keys, JWTs, passwords embedded in URLs, literal bearer tokens).',
  appliesTo: CONFIG_KINDS,
  why: 'Agent configuration files are routinely committed, shared, and copied between machines. A credential stored in one is exposed to everyone who can read the repository and to every tool the agent runs.',
  remediation:
    'Remove the value from the file, rotate the credential with its provider (assume it is compromised if it was ever committed), and reference it through an environment variable instead, for example "${API_KEY}" in .mcp.json or "${env:API_KEY}" in .cursor/mcp.json.',
  check(ctx) {
    return ctx.documents.flatMap((doc) =>
      findSecrets(doc.text).map((match) =>
        findingFor(doc, {
          severity: match.pattern.severity,
          confidence: match.pattern.confidence,
          message: `${match.pattern.name} pattern found. The value is redacted; verify whether it is a live credential.`,
          evidence: redactSecret(match.secret, match.pattern),
          location: doc.locateOffset(match.start),
          key: `${match.pattern.id}:${shortHash(match.secret)}`,
        }),
      ),
    );
  },
};
