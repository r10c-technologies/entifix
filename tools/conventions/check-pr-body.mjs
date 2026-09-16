/**
 * Refuses a pull request body carrying AI attribution.
 *
 * The body is the one surface no git hook can see: `commit-msg` never runs on
 * it, and it is written in a browser. It reuses the same predicate the
 * commitlint rule uses rather than restating the patterns, so the two can never
 * disagree about what counts.
 *
 * Reads the body on stdin so it never appears in a command line, an argument
 * list or a process table.
 */
import { findAttribution, formatAttributionFindings } from './attribution.mjs';

const body = await new Promise(resolve => {
  let text = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', chunk => (text += chunk));
  process.stdin.on('end', () => resolve(text));
});

const findings = findAttribution(body);

if (findings.length > 0) {
  console.error(formatAttributionFindings(findings, 'This pull request body'));
  process.exit(1);
}

console.log('Pull request body carries no attribution trailer.');
