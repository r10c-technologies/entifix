/**
 * Prints one version's section of `CHANGELOG.md`.
 *
 * Two surfaces need the same text and must not drift: the release pull
 * request's body, which is what a human reads before approving a release, and
 * the GitHub Release's notes, which is what everyone else reads afterwards.
 * Generating both from the file means the announcement cannot describe
 * something other than what shipped.
 *
 * Usage: node tools/release/changelog-section.mjs <version> [changelog path]
 */
import { readFile } from 'node:fs/promises';

const [, , version, file = 'CHANGELOG.md'] = process.argv;

if (!version) {
  console.error('usage: changelog-section.mjs <version> [changelog path]');
  process.exit(1);
}

const lines = (await readFile(file, 'utf8')).split('\n');

/** A markdown ATX heading of any level: `## 0.1.1 (2026-09-16)`. */
const heading = /^(#{1,6})\s+(.*)$/;

/**
 * Nx writes the bare version, but a `v` prefix and a link wrapper are both
 * common enough in changelogs to tolerate. The version is escaped because `.`
 * is a regex metacharacter — unescaped, `0.1.1` also matches `0x1y1`.
 */
const escaped = version.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const titleMatches = new RegExp(`^\\[?v?${escaped}\\]?(\\s|\\(|$)`);

const start = lines.findIndex(line => {
  const match = line.match(heading);
  return match !== null && titleMatches.test(match[2].trim());
});

if (start === -1) {
  // Failing loudly matters more than falling back to the whole file: a release
  // announcing every version ever cut is worse than a release that stops.
  console.error(`No section for version "${version}" in ${file}`);
  process.exit(1);
}

// The section runs to the next heading at the same level or higher, so a
// `### 🩹 Fixes` subsection inside it does not end it early.
const level = (lines[start].match(heading) ?? [])[1]?.length ?? 2;
let end = lines.length;
for (let i = start + 1; i < lines.length; i++) {
  const match = lines[i].match(heading);
  if (match && match[1].length <= level) {
    end = i;
    break;
  }
}

console.log(
  lines
    .slice(start + 1, end)
    .join('\n')
    .trim(),
);
