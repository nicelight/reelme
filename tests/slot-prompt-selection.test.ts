/** Verify a bounded sample of materialized prompts against accepted budgets and
 * API token syntax. Do not expand this into exhaustive tests of all prompt files.
 * Source: docs/slot-setup/matrix.md; catalog: src/shared/slot-setup-matrix.json.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { models } from '../src/shared/scenarios.js';
import { selectSlotPrompt, slotSetupMatrix, type SlotPromptSelection } from '../src/shared/slot-prompt-selection.js';

const assets = fileURLToPath(new URL('../public/slot-prompts/', import.meta.url));
const sequence = (count: number, offset = 1) => Array.from({ length: count }, (_, index) => index + offset);
const tokens = (text: string, pattern: RegExp) => [...new Set([...text.matchAll(pattern)].map(match => Number(match[1])))].sort((a, b) => a - b);

test('representative prompts cover model families, identity roles and reference boundaries', async () => {
  assert.equal(slotSetupMatrix.version, 1);
  assert.equal(slotSetupMatrix.source, 'docs/slot-setup/matrix.md');
  assert.equal(slotSetupMatrix.promptBaseUrl, '/slot-prompts/');
  assert.deepEqual(slotSetupMatrix.models.map(m => `${m.mode}:${m.id}`).sort(), models.map(m => `${m.mode}:${m.id}`).sort());
  // Deliberately bounded selection; do not enumerate the complete prompt catalog.
  const samples: Array<[string, SlotPromptSelection['participants'], number, number]> = [
    ['recast', 1, 1, 0], ['recast', 2, 1, 0],
    ['kling-o3-reference', 2, 3, 5],
    ['kling-v4-edit', 2, 4, 10], ['kling-v4-flash-edit', 'group', 4, 6],
    ['kling-v4-reference', 1, 2, 0], ['kling-v4-flash-reference', 'group', 1, 0],
    ['wan-3-edit', 2, 4, 2], ['wan-3-edit', 'group', 2, 1],
    ['h3-reference', 1, 1, 8], ['h3-reference', 2, 4, 1],
    ['vidu-q4-reference', 'group', 4, 8], ['vidu-q4-reference', 2, 3, 0],
    ['gemini-omni-reference', 2, 4, 2], ['gemini-omni-reference', 'group', 1, 0],
  ];
  for (const [key, participants, photos, references] of samples) {
    const model = slotSetupMatrix.models.find(m => m.key === key)!;
    const variant = model.captureVariants.find(v => v.participants === participants && v.photosPerParticipant === photos)!;
    assert.ok(variant, key);
    const recast = key === 'recast';
    const kling = model.id.includes('kling');
    const v4 = model.id.startsWith('kling/v4/');
    const group = participants === 'group';
    const people = group ? 1 : participants;
    const camera = people * photos;
    assert.equal(variant.cameraPhotos, camera);
    assert.equal(variant.elementsCount, kling && !group ? people : 0);
    const budget = recast ? 0 : v4 ? 10 : kling ? 7
      : key === 'h3-reference' ? 9 : key === 'vidu-q4-reference' ? 12 : 10;
    const used = recast || (v4 && !group) ? 0 : kling && !group ? people : camera;
    assert.equal(variant.additionalReferenceLimit, budget - used, key);
    const selected = selectSlotPrompt({ model: model.id, mode: model.mode, participants,
      photosPerParticipant: photos, additionalReferenceCount: references });
    const expectedFile = `${key}/${group ? 'group' : `people-${people}`}__photos-${photos}__refs-${references}.md`;
    assert.equal(selected.file, expectedFile);
    assert.equal(selected.url, `/slot-prompts/${expectedFile}`);
    const text = await readFile(join(assets, selected.file), 'utf8');
    assert.ok(text.length <= model.promptMaxLength, selected.file);
    assert.doesNotMatch(text, /\{\{|\}\}|```|^---|^#|SUBJECT_INSTRUCTION|REFERENCE_INSTRUCTION|GROUP_REFS|SCENE_REFS|identity_block|scene_reference_block/m, selected.file);
    if (recast) { assert.equal(text, '', selected.file); continue; }
    assert.ok(text.trim().length > 0, selected.file);
    if (kling) {
      assert.deepEqual(tokens(text, /@Element(\d+)/g), group ? [] : sequence(people), selected.file);
      assert.deepEqual(tokens(text, /@Image(\d+)/g), sequence(references + (group ? camera : 0)), selected.file);
      assert.deepEqual(tokens(text, /@Video(\d+)/g), model.mode === 'V2V' ? [1] : [], selected.file);
      assert.doesNotMatch(text, /IMAGE_REF_|reference_image_|\bImage \d/, selected.file);
    } else {
      assert.doesNotMatch(text, /@Element|@Image\d|@Video|VIDEO_REF_/, selected.file);
      if (key === 'wan-3-edit') assert.match(text, /^Edit Video 1\./);
      const pattern = key === 'h3-reference' || key === 'wan-3-edit' ? /\bImage (\d+)/g : key === 'vidu-q4-reference' ? /\[@reference_image_(\d+)\]/g : /<IMAGE_REF_(\d+)>/g;
      assert.deepEqual(tokens(text, pattern), sequence(camera + references, key === 'gemini-omni-reference' ? 0 : 1), selected.file);
    }
  }
});

test('ready prompt distinguishes two people from a group and offsets scene references', async () => {
  const read = async (input: SlotPromptSelection) => readFile(join(assets, selectSlotPrompt(input).file), 'utf8');
  const base = { model: 'minimax/h3-max/reference-to-video', mode: 'P2V' as const, photosPerParticipant: 4, additionalReferenceCount: 1 };
  const individual = await read({ ...base, participants: 2 });
  assert.match(individual, /Image 1, Image 2, Image 3, Image 4[^\n]*Person 1/);
  assert.match(individual, /Image 5, Image 6, Image 7, Image 8[^\n]*Person 2/);
  assert.match(individual, /Use Image 9 /);
  const group = await read({ ...base, participants: 'group' });
  assert.match(group, /Image 1, Image 2, Image 3, Image 4[^\n]*group/);
  assert.match(group, /Use Image 5 /);
  assert.doesNotMatch(group, /Person [12]/);
});

test('selection rejects unsupported tuples instead of silently choosing another prompt', () => {
  const valid: SlotPromptSelection = { model: 'kling/v4/flash/video-to-video', mode: 'V2V',
    participants: 2, photosPerParticipant: 4, additionalReferenceCount: 2 };
  for (const change of [{ model: 'unknown' }, { mode: 'P2V' }, { photosPerParticipant: 1 }, { photosPerParticipant: 2.5 },
    { participants: 3 }, { participants: '2' }, { additionalReferenceCount: -1 }, { additionalReferenceCount: 11 },
    { additionalReferenceCount: 0.5 }, { additionalReferenceCount: NaN }, { additionalReferenceCount: Infinity }]) {
    assert.throws(() => selectSlotPrompt({ ...valid, ...change } as SlotPromptSelection), JSON.stringify(change));
  }
  assert.throws(() => selectSlotPrompt({ ...valid, model: 'minimax/h3-max/recast', participants: 'group', photosPerParticipant: 1, additionalReferenceCount: 0 }));
});

test('output parameters reflect the API and do not multiply the prompt-file keys', () => {
  for (const model of slotSetupMatrix.models) {
    if (model.id.startsWith('fal-ai/kling-video/')) assert.deepEqual(model.resolutionOptions, []);
    else if (model.id.includes('/flash/')) assert.deepEqual(model.resolutionOptions, ['720p']);
    else if (model.id.startsWith('minimax/')) assert.deepEqual(model.resolutionOptions, ['768P', '1080P']);
    else assert.deepEqual(model.resolutionOptions, ['720p', '1080p']);
    if (model.orientationMode === 'source-video') {
      assert.equal(model.mode, 'V2V');
      assert.deepEqual(model.aspectRatios, { landscape: [], portrait: [] });
    } else {
      assert.ok(model.aspectRatios.landscape.includes('16:9'));
      assert.ok(model.aspectRatios.portrait.includes('9:16'));
      assert.ok(model.aspectRatios.landscape.every(ratio => Number(ratio.split(':')[0]) > Number(ratio.split(':')[1])));
      assert.ok(model.aspectRatios.portrait.every(ratio => Number(ratio.split(':')[0]) < Number(ratio.split(':')[1])));
    }
    const variant = model.captureVariants[0];
    assert.deepEqual(Object.keys(variant).sort(), ['participants', 'photosPerParticipant', 'cameraPhotos', 'elementsCount', 'additionalReferenceLimit', 'promptFiles'].sort());
  }
});
