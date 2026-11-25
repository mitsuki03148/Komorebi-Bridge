import { join } from 'node:path';
import { bridgeConfig } from '../bridge/config';
import { experienceFile, readExperience, readExperienceInput, summarizeExperience } from '../bridge/bench-experience';

try {
  const [action, groupId, from, until, reviewPath, ...rest] = process.argv.slice(2);
  if (!groupId || rest.length || (action === 'events' && from !== undefined) ||
      (action === 'summary' && (!from || !until)) || (action !== 'events' && action !== 'summary')) {
    throw new Error('Usage: node --import tsx scripts/bench-experience.ts events <group> | summary <group> <from-UTC> <until-UTC> [local-review.jsonl]');
  }
  const path = join(bridgeConfig().workspace, experienceFile);
  const raw = readExperienceInput(path);
  if (action === 'events') {
    const { events, ...coverage } = readExperience(raw);
    console.log(JSON.stringify({ coverage, events: events.filter(event => event.groupId === groupId) }, null, 2));
  } else {
    console.log(JSON.stringify(summarizeExperience(raw, groupId, from, until, reviewPath ? readExperienceInput(reviewPath) : undefined), null, 2));
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Unable to read workbench experience.');
  process.exitCode = 1;
}
