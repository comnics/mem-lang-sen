import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { conversationCatalog } from '../prisma/seed-data/catalog';

if (process.platform !== 'darwin') throw new Error('Audio generation uses macOS Samantha. Normal seeding uses the committed WAV fixtures on any platform.');
const directory = join(process.cwd(), 'fixtures/audio');
mkdirSync(directory, { recursive: true });
let generated = 0;
for (const topic of conversationCatalog) {
  for (const sentence of topic.sentences) {
    const path = join(directory, sentence.audioFile);
    if (existsSync(path)) continue;
    execFileSync('/usr/bin/say', ['-v', 'Samantha', '-r', '155', '-o', path, '--file-format=WAVE', '--data-format=LEI16@22050', sentence.data.target]);
    generated += 1;
  }
}
console.log(`Generated ${generated} English WAV fixtures (Samantha synthetic voice).`);
