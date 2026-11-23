import {
  agentFileLabel,
  allowedTools,
  frontmatterFieldLocation,
  isAgentFile,
} from './agent-file-model.js';
import { isUnrestrictedShellRule } from './acd010-risky-combinations.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

export const broadAgentPermissions: Rule = {
  id: 'ACD012',
  name: 'broad-agent-file-permissions',
  title: 'Broad permission in a skill, command or subagent',
  severity: 'high',
  description:
    'Flags Claude Code skills and custom commands whose allowed-tools pre-approves every shell command, and subagents that set permissionMode to bypassPermissions.',
  appliesTo: ['claude-skill', 'claude-command', 'claude-agent'],
  why: 'Skills, commands and subagents are shared through the repository and loaded by name, often by the model itself. A broad grant in one turns every use of it into a session where commands run without a prompt.',
  remediation: 'Apply the remediation in the finding.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    for (const doc of ctx.documents) {
      if (!isAgentFile(doc)) continue;
      const what = agentFileLabel(doc.kind);

      // With disable-model-invocation the model cannot load the file by itself;
      // the grant applies only when a person runs it explicitly.
      const userOnly = doc.frontmatter?.fields['disable-model-invocation'] === true;
      for (const tool of allowedTools(doc)) {
        if (!isUnrestrictedShellRule(tool)) continue;
        findings.push(
          findingFor(doc, {
            severity: userOnly ? 'medium' : 'high',
            confidence: 'high',
            message: `This ${what}'s allowed-tools entry "${tool}" pre-approves every shell command while the ${what} is active${userOnly ? ' (only when run explicitly, because disable-model-invocation is true)' : ', and the model can load it by itself'}.`,
            evidence: tool,
            location: frontmatterFieldLocation(doc, 'allowed-tools'),
            key: `allowed-tools:${tool}`,
            remediation:
              'List only the commands the skill needs, for example "Bash(git diff *)" or "Bash(npm run test *)".',
          }),
        );
      }

      const mode = doc.frontmatter?.fields['permissionMode'];
      if (doc.kind === 'claude-agent' && mode === 'bypassPermissions') {
        findings.push(
          findingFor(doc, {
            severity: 'high',
            confidence: 'medium',
            message:
              'This subagent sets permissionMode: bypassPermissions, so its tool calls run without permission prompts.',
            evidence: 'permissionMode: bypassPermissions',
            location: frontmatterFieldLocation(doc, 'permissionMode'),
            key: 'permissionMode:bypassPermissions',
            remediation:
              'Remove permissionMode, or use a narrower mode such as "acceptEdits" together with a restricted "tools" list.',
          }),
        );
      }
    }
    return findings;
  },
};
