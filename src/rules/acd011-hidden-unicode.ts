import type { Severity } from '../types/index.js';
import { CONFIG_KINDS } from '../types/index.js';
import { findingFor, type Rule, type RuleFinding } from './types.js';

interface CharClass {
  id: string;
  label: string;
  severity: Severity;
  test(codePoint: number, offset: number): boolean;
}

const CLASSES: CharClass[] = [
  {
    id: 'bidi-control',
    label: 'bidirectional control characters',
    severity: 'high',
    test: (cp) => (cp >= 0x202a && cp <= 0x202e) || (cp >= 0x2066 && cp <= 0x2069),
  },
  {
    id: 'tag-characters',
    label: 'Unicode tag characters (invisible text)',
    severity: 'high',
    test: (cp) => cp >= 0xe0000 && cp <= 0xe007f,
  },
  {
    id: 'zero-width',
    label: 'zero-width characters',
    severity: 'medium',
    // U+200C/U+200D are excluded: they are legitimate in emoji sequences and several scripts.
    test: (cp, offset) => cp === 0x200b || cp === 0x2060 || (cp === 0xfeff && offset > 0),
  },
];

export const hiddenUnicode: Rule = {
  id: 'ACD011',
  name: 'hidden-unicode',
  title: 'Hidden or bidirectional Unicode characters',
  severity: 'high',
  description:
    'Detects bidirectional-override, Unicode tag and zero-width characters in agent configuration and instruction files.',
  appliesTo: CONFIG_KINDS,
  why: 'Invisible and direction-changing characters make the text a human reviewer sees differ from the text an agent or parser reads. They have been used to hide instructions in agent rule files and to disguise code in reviews.',
  remediation:
    'Remove the characters (many editors can reveal them, or search for U+202A-U+202E, U+2066-U+2069, U+200B, U+2060 and U+E0000-U+E007F). Treat a file from an untrusted source that contains them with suspicion.',
  check(ctx) {
    const findings: RuleFinding[] = [];
    for (const doc of ctx.documents) {
      const hits = new Map<string, { count: number; first: number; codePoints: Set<number> }>();
      let offset = 0;
      for (const ch of doc.text) {
        const cp = ch.codePointAt(0) ?? 0;
        if (cp >= 0x200b) {
          for (const cls of CLASSES) {
            if (!cls.test(cp, offset)) continue;
            const hit = hits.get(cls.id) ?? {
              count: 0,
              first: offset,
              codePoints: new Set<number>(),
            };
            hit.count++;
            hit.codePoints.add(cp);
            hits.set(cls.id, hit);
          }
        }
        offset += ch.length;
      }
      for (const cls of CLASSES) {
        const hit = hits.get(cls.id);
        if (!hit) continue;
        const codes = [...hit.codePoints]
          .sort((a, b) => a - b)
          .slice(0, 6)
          .map((cp) => `U+${cp.toString(16).toUpperCase().padStart(4, '0')}`);
        findings.push(
          findingFor(doc, {
            severity: cls.severity,
            confidence: 'high',
            message: `File contains ${hit.count} ${cls.label}.`,
            evidence: codes.join(', '),
            location: doc.locateOffset(hit.first),
            key: cls.id,
          }),
        );
      }
    }
    return findings;
  },
};
