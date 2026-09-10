import { normalizeName, sameName, isUnknown } from './protocol.js';
export const isFinal = result => ['match', 'mismatch', 'judge_unknown', 'author_unknown'].includes(result.status);
export const classifyGuess = (name, guess) => sameName(name, guess) ? 'match' : isUnknown(guess) ? 'judge_unknown' : 'mismatch';
export const retryStage = result => result.portrait && !['identity_leak', 'invalid_portrait', 'author_unknown'].includes(result.status) ? 'identify' : 'portrait';
export function scoreResults(results) {
  const matched = results.filter(result => result.status === 'match').length;
  const completed = results.filter(isFinal).length;
  return { matched, completed, total: results.length, pending: results.length - completed };
}
export function parsePeople(value) {
  const people = [], errors = [], seen = new Set();
  value.split(/\r?\n/).forEach((raw, index) => {
    const line = raw.trim();
    if (!line) return;
    const match = line.match(/^(.+?)[;,\t]\s*(\d{4})\s*$/);
    if (!match) { errors.push(`Řádek ${index + 1}: použijte zápis „Jméno, 1972“.`); return; }
    const name = match[1].trim().replace(/\s+/g, ' '), birthYear = Number(match[2]);
    if (name.length < 2 || name.length > 100 || birthYear < 1850 || birthYear > new Date().getFullYear()) { errors.push(`Řádek ${index + 1}: jméno nebo rok nevypadá platně.`); return; }
    const key = `${normalizeName(name)}|${birthYear}`;
    if (!seen.has(key)) { people.push({ name, birthYear, key }); seen.add(key); }
  });
  if (people.length > 40) errors.push('Pilot přijme nejvýše 40 jmen najednou.');
  return { people, errors };
}
