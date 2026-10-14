import { writeFile } from 'node:fs/promises';
import { Command, CommanderError, InvalidArgumentError, Option } from 'commander';
import {
  BaselineError,
  compareWithBaseline,
  createBaseline,
  readBaseline,
  writeBaseline,
  type Baseline,
} from '../baseline/baseline.js';
import { InputError } from '../discovery/discover.js';
import { DEFAULT_CONFIG, loadConfig } from '../engine/config.js';
import { scan, type ScanOptions } from '../engine/scan.js';
import { shouldUseColor } from '../reporters/colors.js';
import { renderHtml } from '../reporters/html.js';
import { renderJson } from '../reporters/json.js';
import { buildReport, type FailOn, type Report } from '../reporters/report.js';
import { renderTerminal } from '../reporters/terminal.js';
import { MCP_VALIDATION_RULE_IDS, RULES } from '../rules/index.js';
import { MCP_KINDS, SEVERITIES } from '../types/index.js';
import { TOOL_NAME, VERSION } from '../version.js';

/** Documented, stable exit codes. */
export const EXIT = {
  /** Completed; no counted findings at or above the --fail-on threshold. */
  OK: 0,
  /** Completed; at least one counted finding at or above the threshold. */
  FINDINGS: 1,
  /** Invalid usage or input: bad option, missing path, invalid config or baseline. */
  USAGE: 2,
  /** Unexpected internal error. */
  INTERNAL: 3,
  /** --fail-if-empty was given and no supported files were found. */
  NO_FILES: 4,
} as const;

export interface CliIO {
  stdout: { write(s: string): unknown; isTTY?: boolean };
  stderr: { write(s: string): unknown; isTTY?: boolean };
  env?: NodeJS.ProcessEnv;
}

export const DEFAULT_BASELINE_FILE = '.agentconfig-doctor-baseline.json';

interface CommonOptions {
  include: string[];
  exclude: string[];
  config?: string;
  maxFileSize?: number;
  verbose?: boolean;
  color: boolean;
  failIfEmpty?: boolean;
}

interface ReportOptions extends CommonOptions {
  format: 'terminal' | 'json' | 'html';
  output?: string;
  failOn: FailOn;
  baseline?: string;
}

const collect = (value: string, previous: string[]) => [...previous, value];

function parseSize(value: string): number {
  if (!/^\d+$/.test(value) || Number(value) < 1) {
    throw new InvalidArgumentError('Expected a positive whole number of bytes.');
  }
  return Number(value);
}

function addCommonOptions(cmd: Command): Command {
  return cmd
    .option('--include <glob>', 'only check files matching this glob (repeatable)', collect, [])
    .option(
      '--exclude <glob>',
      'skip files or directories matching this glob (repeatable)',
      collect,
      [],
    )
    .option('--config <file>', 'agentconfig-doctor config file (never loaded implicitly)')
    .option('--max-file-size <bytes>', 'skip files larger than this (default 1048576)', parseSize)
    .option('--fail-if-empty', `exit with code ${EXIT.NO_FILES} when no supported files are found`)
    .option('--no-color', 'disable coloured output')
    .option('--verbose', 'show scanned files, explanations, confidence and fingerprints');
}

async function scanOptionsFrom(opts: CommonOptions): Promise<ScanOptions> {
  const options: ScanOptions = {
    include: opts.include,
    exclude: opts.exclude,
    config: opts.config ? await loadConfig(opts.config) : DEFAULT_CONFIG,
  };
  if (opts.maxFileSize !== undefined) options.maxFileSize = opts.maxFileSize;
  return options;
}

const failOnOption = (defaultValue: FailOn) =>
  new Option('--fail-on <severity>', 'exit with code 1 when a finding is at or above this severity')
    .choices([...SEVERITIES, 'none'])
    .default(defaultValue);

const formatOption = (choices: string[]) =>
  new Option('--format <format>', 'output format').choices(choices).default('terminal');

const HELP_FOOTER = `
Examples:
  $ ${TOOL_NAME} scan                      scan the current directory
  $ ${TOOL_NAME} scan ./my-project --fail-on medium
  $ ${TOOL_NAME} scan --format json --output report.json
  $ ${TOOL_NAME} scan --format html --output report.html
  $ ${TOOL_NAME} baseline create
  $ ${TOOL_NAME} scan --baseline ${DEFAULT_BASELINE_FILE}
  $ ${TOOL_NAME} check-mcp .cursor/mcp.json
  $ ${TOOL_NAME} rules

Exit codes:
  0  no findings at or above --fail-on (default: high)
  1  findings at or above --fail-on (only new findings count when --baseline is used)
  2  usage or input error (bad option, missing path, invalid config or baseline)
  3  unexpected internal error
  4  no supported files found and --fail-if-empty was given

Privacy: scanning is local. No network requests, no telemetry, and commands
found in configuration files are never executed.`;

export async function run(argv: readonly string[], io: CliIO): Promise<number> {
  const env = io.env ?? process.env;
  let exitCode: number = EXIT.OK;
  const out = (s: string) => io.stdout.write(s);
  const err = (s: string) => io.stderr.write(s);

  const emit = async (report: Report, opts: ReportOptions) => {
    let text: string;
    if (opts.format === 'json') text = renderJson(report);
    else if (opts.format === 'html') text = renderHtml(report);
    else {
      text = renderTerminal(report, {
        color: opts.output ? false : shouldUseColor(opts.color, io.stdout, env),
        verbose: Boolean(opts.verbose),
      });
    }
    if (!opts.output) {
      out(text);
      return;
    }
    try {
      await writeFile(opts.output, text, 'utf8');
    } catch (error) {
      throw new InputError(`Cannot write report to "${opts.output}": ${(error as Error).message}`);
    }
    const { summary } = report;
    const verdict = summary.failOn === 'none' ? 'not evaluated' : summary.failed ? 'FAIL' : 'PASS';
    err(`Report written to ${opts.output} (${summary.findings} findings, result: ${verdict}).\n`);
  };

  const verdictCode = (report: Report, opts: CommonOptions): number => {
    if (opts.failIfEmpty && report.summary.filesScanned === 0) return EXIT.NO_FILES;
    return report.summary.failed ? EXIT.FINDINGS : EXIT.OK;
  };

  const program = new Command()
    .name(TOOL_NAME)
    .description(
      'Find exposed credentials, risky commands, broad permissions and invalid MCP server definitions in AI coding-agent configuration (Claude Code, Cursor, VS Code).',
    )
    .version(VERSION, '-V, --version', 'print the version')
    .showHelpAfterError('(run with --help for usage)')
    .exitOverride()
    .configureOutput({ writeOut: out, writeErr: err })
    .addHelpText('after', HELP_FOOTER);

  addCommonOptions(
    program
      .command('scan')
      .description('scan a directory or a single config file for security and configuration issues')
      .argument('[path]', 'directory or supported config file to scan', '.')
      .addOption(formatOption(['terminal', 'json', 'html']))
      .option('--output <file>', 'write the report to a file instead of stdout')
      .addOption(failOnOption('high'))
      .option(
        '--baseline <file>',
        'compare with a baseline: only new findings count toward --fail-on, and permission changes are reported (ACD009)',
      ),
  ).action(async (target: string, opts: ReportOptions) => {
    const options = await scanOptionsFrom(opts);
    let baseline: Baseline | undefined;
    if (opts.baseline) {
      baseline = await readBaseline(opts.baseline);
      options.baselinePermissions = baseline.permissions;
    }
    const result = await scan(target, options);
    const report = buildReport(target, result, {
      failOn: opts.failOn,
      baseline:
        baseline && opts.baseline
          ? { file: opts.baseline, comparison: compareWithBaseline(result.findings, baseline) }
          : undefined,
    });
    await emit(report, opts);
    exitCode = verdictCode(report, opts);
  });

  addCommonOptions(
    program
      .command('check-mcp')
      .description(
        'validate MCP configuration files (.mcp.json, .cursor/mcp.json, .vscode/mcp.json)',
      )
      .argument('[path]', 'directory or MCP config file to check', '.')
      .addOption(formatOption(['terminal', 'json']))
      .addOption(failOnOption('medium')),
  ).action(async (target: string, opts: ReportOptions) => {
    const options = await scanOptionsFrom(opts);
    options.kinds = MCP_KINDS;
    options.ruleIds = MCP_VALIDATION_RULE_IDS;
    const result = await scan(target, options);
    const report = buildReport(target, result, { failOn: opts.failOn });
    await emit(report, opts);
    exitCode = verdictCode(report, opts);
  });

  program
    .command('rules')
    .description('list rule IDs, severities, descriptions and supported configuration types')
    .addOption(formatOption(['terminal', 'json']))
    .action((opts: { format: 'terminal' | 'json' }) => {
      if (opts.format === 'json') {
        const rules = RULES.map((r) => ({
          id: r.id,
          name: r.name,
          title: r.title,
          severity: r.severity,
          description: r.description,
          appliesTo: r.appliesTo,
          requiresBaseline: r.requiresBaseline ?? false,
        }));
        out(`${JSON.stringify({ tool: { name: TOOL_NAME, version: VERSION }, rules }, null, 2)}\n`);
        return;
      }
      const lines: string[] = [];
      for (const r of RULES) {
        const baselineNote = r.requiresBaseline ? '  [requires --baseline]' : '';
        lines.push(`${r.id}  ${r.title}  (up to ${r.severity})${baselineNote}`);
        lines.push(`  name: ${r.name}`);
        lines.push(`  applies to: ${r.appliesTo.join(', ')}`);
        lines.push(`  ${r.description}`);
        lines.push('');
      }
      out(lines.join('\n'));
    });

  program
    .command('version')
    .description('print the version')
    .action(() => {
      out(`${VERSION}\n`);
    });

  const baselineCmd = program
    .command('baseline')
    .description('create or update a baseline of accepted findings and permissions');
  for (const mode of ['create', 'update'] as const) {
    addCommonOptions(
      baselineCmd
        .command(mode)
        .description(
          mode === 'create'
            ? 'write a new baseline (refuses to overwrite an existing file)'
            : 'replace an existing baseline with the current state (refuses to create a new file)',
        )
        .argument('[path]', 'directory to scan', '.')
        .option('--output <file>', 'baseline file', DEFAULT_BASELINE_FILE),
    ).action(async (target: string, opts: CommonOptions & { output: string }) => {
      const previous = mode === 'update' ? await readBaseline(opts.output) : undefined;
      const result = await scan(target, await scanOptionsFrom(opts));
      if (opts.failIfEmpty && result.files.length === 0) {
        err('No supported agent configuration files were found; baseline not written.\n');
        exitCode = EXIT.NO_FILES;
        return;
      }
      const baseline = createBaseline(result.findings, result.permissions);
      await writeBaseline(opts.output, baseline, mode);
      let message = `Baseline ${mode === 'create' ? 'created' : 'updated'}: ${opts.output} (${baseline.findings.length} findings, ${result.files.length} files).`;
      if (previous) {
        const before = new Set(previous.findings.map((f) => f.fingerprint));
        const after = new Set(baseline.findings.map((f) => f.fingerprint));
        const added = [...after].filter((f) => !before.has(f)).length;
        const removed = [...before].filter((f) => !after.has(f)).length;
        message += ` ${added} added, ${removed} removed since the previous baseline.`;
      }
      err(`${message}\n`);
    });
  }

  try {
    await program.parseAsync([...argv], { from: 'user' });
    return exitCode;
  } catch (error) {
    if (error instanceof CommanderError) {
      const ok = ['commander.helpDisplayed', 'commander.version', 'commander.help'];
      return ok.includes(error.code) ? EXIT.OK : EXIT.USAGE;
    }
    if (error instanceof InputError || error instanceof BaselineError) {
      err(`error: ${error.message}\n`);
      return EXIT.USAGE;
    }
    err(`internal error: ${error instanceof Error ? error.message : String(error)}\n`);
    if (argv.includes('--verbose') && error instanceof Error && error.stack) {
      err(`${error.stack}\n`);
    }
    return EXIT.INTERNAL;
  }
}
