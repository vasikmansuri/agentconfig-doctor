import { isRecord } from '../util/text.js';
import { getMcpServers } from './mcp-model.js';
import {
  getSettings,
  isSettingsDocument,
  parsePermissionRule,
  projectDirOf,
  stringsAt,
} from './settings-model.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

/** Allow rules that approve every shell command. */
export function isUnrestrictedShellRule(raw: string): boolean {
  const rule = parsePermissionRule(raw);
  if (!rule || !/^(?:Bash|PowerShell)$/.test(rule.tool)) return false;
  if (rule.specifier === undefined) return true;
  return /^\s*(?:\*|:\*|\*\s*\*)\s*$/.test(rule.specifier);
}

export const riskyCombinations: Rule = {
  id: 'ACD010',
  name: 'risky-combination',
  title: 'Risky combination of settings',
  severity: 'high',
  description:
    'Flags combinations that materially increase risk in Claude Code projects: auto-approving every project MCP server (enableAllProjectMcpServers) while the project defines local servers, and allowing every shell command without the Bash sandbox enabled.',
  appliesTo: ['claude-settings', 'claude-mcp'],
  why: 'Each setting alone may be reasonable, but together they remove the last confirmation step before code from the repository runs on the developer machine.',
  remediation: 'Apply the remediation in the finding.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    const settingsDocs = ctx.documents.filter(isSettingsDocument);

    for (const doc of settingsDocs) {
      const settings = getSettings(doc);
      if (!settings) continue;
      const projectDir = projectDirOf(doc.path);

      if (settings.enableAllProjectMcpServers === true) {
        const mcpPath = projectDir ? `${projectDir}/.mcp.json` : '.mcp.json';
        const mcpDoc = ctx.documents.find((d) => d.path === mcpPath);
        const local = (mcpDoc ? getMcpServers(mcpDoc) : []).filter((s) => s.command !== undefined);
        findings.push(
          findingFor(doc, {
            severity: local.length > 0 ? 'high' : 'medium',
            confidence: 'high',
            message:
              local.length > 0
                ? `enableAllProjectMcpServers is true and ${mcpPath} defines ${local.length} local server(s) (${local.map((s) => `"${s.name}"`).join(', ')}). They start without an approval prompt.`
                : 'enableAllProjectMcpServers is true: any server later added to the project .mcp.json starts without an approval prompt.',
            location: doc.locate(['enableAllProjectMcpServers']),
            key: 'enable-all-project-mcp',
            why: 'Project .mcp.json files arrive through git pulls and pull requests. Auto-approval means a single commit can make every collaborator run a new local program the next time they open the project.',
            remediation:
              'Set enableAllProjectMcpServers to false and approve individual servers with "enabledMcpjsonServers", ideally in .claude/settings.local.json rather than the shared settings file.',
          }),
        );
      }

      const unrestricted = stringsAt(settings, ['permissions', 'allow']).find((e) =>
        isUnrestrictedShellRule(e.value),
      );
      if (!unrestricted) continue;
      const sandboxOn = settingsDocs.some((d) => {
        const s = getSettings(d);
        return (
          projectDirOf(d.path) === projectDir && isRecord(s?.sandbox) && s.sandbox.enabled === true
        );
      });
      if (sandboxOn) continue;
      findings.push(
        findingFor(doc, {
          severity: 'high',
          confidence: 'high',
          message: `Permission allow rule "${unrestricted.value}" approves every shell command, and the Bash sandbox is not enabled in this project's settings.`,
          location: doc.locate(unrestricted.path),
          key: `unrestricted-shell:${unrestricted.value}`,
          why: 'With every command pre-approved and no sandbox, a prompt-injected or mistaken agent can run anything on the machine (delete files, read credentials, reach the network) without a prompt.',
          remediation:
            'Replace the blanket rule with specific ones such as "Bash(npm run test *)", or enable "sandbox": { "enabled": true } so approved commands run with filesystem and network isolation.',
        }),
      );
    }
    return findings;
  },
};
