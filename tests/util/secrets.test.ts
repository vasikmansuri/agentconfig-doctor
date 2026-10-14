import { describe, expect, it } from 'vitest';
import {
  findSecrets,
  isPlaceholderValue,
  isVariableReference,
  redactLiteral,
  redactSecret,
  scrubSecrets,
  SECRET_PATTERNS,
} from '../../src/util/secrets.js';
import { fake } from '../helpers.js';

const cases: [string, string][] = [
  ['github-token', fake.github()],
  ['github-fine-grained-token', fake.githubFineGrained()],
  ['gitlab-token', fake.gitlab()],
  ['anthropic-api-key', fake.anthropic()],
  ['openai-api-key', fake.openai()],
  ['aws-access-key-id', fake.aws()],
  ['slack-token', fake.slack()],
  ['stripe-live-key', fake.stripeLive()],
  ['stripe-test-key', fake.stripeTest()],
  ['google-api-key', fake.google()],
  ['npm-token', fake.npm()],
  ['huggingface-token', fake.huggingface()],
  ['jwt', fake.jwt()],
  ['private-key', fake.privateKey()],
  ['slack-webhook', fake.slackWebhook()],
];

describe('findSecrets', () => {
  it.each(cases)('detects %s', (id, secret) => {
    const matches = findSecrets(`{"value": "${secret}"}`);
    expect(matches.map((m) => m.pattern.id)).toContain(id);
  });

  it('covers every pattern with a positive test', () => {
    const tested = new Set([
      ...cases.map(([id]) => id),
      'aws-secret-access-key',
      'url-credentials',
      'bearer-token',
    ]);
    for (const p of SECRET_PATTERNS) expect(tested.has(p.id), p.id).toBe(true);
  });

  it('detects an AWS secret access key assignment', () => {
    const text = `aws_secret_access_key = ${'Qz7Wx3Kp9Lm2/+Ab'.repeat(3).slice(0, 40)}`;
    expect(findSecrets(text).map((m) => m.pattern.id)).toContain('aws-secret-access-key');
  });

  it('detects passwords in URLs but not variable references', () => {
    expect(findSecrets('postgres://admin:Hunter2Hunter2@db.internal:5432/x')[0]?.secret).toBe(
      'Hunter2Hunter2',
    );
    expect(findSecrets('postgres://admin:${DB_PASSWORD}@db.internal/x')).toHaveLength(0);
    expect(findSecrets('postgres://admin:$DB_PASSWORD@db.internal/x')).toHaveLength(0);
  });

  it('detects literal bearer tokens but not references', () => {
    expect(findSecrets('Bearer Zq8Ww2Lk5Pp7Rt3Yu1Io9As4')[0]?.pattern.id).toBe('bearer-token');
    expect(findSecrets('Bearer ${API_TOKEN}')).toHaveLength(0);
    expect(findSecrets('Bearer ${input:token}')).toHaveLength(0);
  });

  it('ignores placeholders and documentation examples', () => {
    expect(findSecrets('sk-ant-your-key-goes-here-xxxxxxxxxxxx')).toHaveLength(0);
    expect(findSecrets(['AKIA', 'IOSFODNN7EXAMPLE'].join(''))).toHaveLength(0);
    expect(findSecrets('postgres://user:<password>@localhost/db')).toHaveLength(0);
    expect(findSecrets('postgres://user:****@localhost/db')).toHaveLength(0);
  });

  it('does not flag ordinary configuration text', () => {
    expect(findSecrets('{"command": "npx", "args": ["-y", "@scope/server@1.2.3"]}')).toHaveLength(
      0,
    );
    expect(findSecrets('sk-short')).toHaveLength(0);
    expect(findSecrets('task-runner-for-the-project')).toHaveLength(0);
  });

  it('detects distinctive vendor tokens glued to other text, but not generic prefixes', () => {
    expect(findSecrets(`prefixJ${fake.github()}`).map((m) => m.pattern.id)).toEqual([
      'github-token',
    ]);
    expect(findSecrets(`name${fake.npm()}`).map((m) => m.pattern.id)).toEqual(['npm-token']);
    expect(findSecrets('task-runner-for-the-project-abc')).toHaveLength(0);
  });

  it('does not report Anthropic keys as OpenAI keys', () => {
    expect(findSecrets(fake.anthropic()).map((m) => m.pattern.id)).toEqual(['anthropic-api-key']);
  });

  it('returns non-overlapping matches in order', () => {
    const matches = findSecrets(`${fake.github()} and ${fake.npm()}`);
    expect(matches).toHaveLength(2);
    expect(matches[0]!.start).toBeLessThan(matches[1]!.start);
  });
});

describe('redaction', () => {
  it('keeps at most the public prefix', () => {
    const secret = fake.github();
    const [m] = findSecrets(secret);
    const redacted = redactSecret(secret, m!.pattern);
    expect(redacted).toBe('ghp_****');
    expect(redacted).not.toContain(secret.slice(4, 10));
  });

  it('never reveals more than half of a value', () => {
    expect(redactSecret('abcd', { ...SECRET_PATTERNS[1]!, keepPrefix: 10 })).toBe('ab****');
  });

  it('reveals nothing for patterns without a public prefix', () => {
    expect(redactSecret('Hunter2Hunter2')).toBe('****');
    expect(redactLiteral('topsecretvalue')).toBe('**** (14 chars)');
  });

  it('keeps only the header of a private key', () => {
    const [m] = findSecrets(fake.privateKey());
    expect(redactSecret(m!.secret, m!.pattern)).toBe('-----BEGIN RSA PRIVATE KEY-----****');
  });

  it('scrubs every secret from arbitrary text', () => {
    const secrets = cases.map(([, s]) => s);
    const scrubbed = scrubSecrets(secrets.join(' | '));
    for (const s of secrets) expect(scrubbed).not.toContain(s);
    expect(scrubSecrets('nothing to see')).toBe('nothing to see');
  });
});

describe('value helpers', () => {
  it('recognises variable references', () => {
    for (const v of [
      '${API_KEY}',
      '${env:API_KEY}',
      '${input:token}',
      'Bearer ${TOKEN}',
      '$TOKEN',
      '{{TOKEN}}',
    ]) {
      expect(isVariableReference(v), v).toBe(true);
    }
    expect(isVariableReference('literal')).toBe(false);
  });

  it('recognises placeholders', () => {
    for (const v of [
      '',
      'xxxx',
      '****',
      '<your token>',
      'your-api-key',
      'CHANGEME',
      'placeholder-value',
    ]) {
      expect(isPlaceholderValue(v), v).toBe(true);
    }
    expect(isPlaceholderValue('Qz7Wx3Kp9Lm2')).toBe(false);
  });
});
