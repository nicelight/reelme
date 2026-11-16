#!/usr/bin/env node
/** Module contract: offline authoring tool for the materialized slot prompt catalog.
 * Source: docs/slot-setup/matrix.md. Writes only the shared JSON index and ready
 * prompt Markdown assets; --check compares them without modifying files.
 * The application reads these files verbatim, never executes this generator,
 * interpolates templates, reads slot descriptions or calls a language model.
 */
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const assetRoot = join(root, 'public/slot-prompts');
const matrixPath = join(root, 'src/shared/slot-setup-matrix.json');
const check = process.argv.includes('--check');
if (process.argv.slice(2).some(arg => arg !== '--check')) {
  throw new Error('Usage: node scripts/generate-slot-prompts.mjs [--check]');
}

const sourceVideo = { orientationMode: 'source-video', aspectRatios: { landscape: [], portrait: [] } };
const ratios = (landscape = ['16:9'], portrait = ['9:16']) => ({
  orientationMode: 'aspect-ratio', aspectRatios: { landscape, portrait },
});
const models = [
  { key: 'recast', id: 'minimax/h3-max/recast', mode: 'V2V', referenceStrategy: 'recast', resolutionOptions: ['768P', '1080P'], ...sourceVideo, promptMaxLength: 2000 },
  { key: 'kling-o1-edit', id: 'fal-ai/kling-video/o1/video-to-video/edit', mode: 'V2V', referenceStrategy: 'elements', resolutionOptions: [], ...sourceVideo, promptMaxLength: 2500 },
  { key: 'kling-o3-edit', id: 'fal-ai/kling-video/o3/pro/video-to-video/edit', mode: 'V2V', referenceStrategy: 'elements', resolutionOptions: [], ...sourceVideo, promptMaxLength: 2500 },
  { key: 'kling-v4-edit', id: 'kling/v4/video-to-video/edit', mode: 'V2V', referenceStrategy: 'elements', resolutionOptions: ['720p', '1080p'], ...ratios(['16:9', '21:9']), promptMaxLength: 26000 },
  { key: 'kling-v4-flash-edit', id: 'kling/v4/flash/video-to-video', mode: 'V2V', referenceStrategy: 'elements', resolutionOptions: ['720p'], ...sourceVideo, promptMaxLength: 26000 },
  { key: 'kling-v4-reference', id: 'kling/v4/reference-to-video', mode: 'P2V', referenceStrategy: 'elements', resolutionOptions: ['720p', '1080p'], ...ratios(['16:9', '21:9']), promptMaxLength: 26000 },
  { key: 'kling-o3-reference', id: 'fal-ai/kling-video/o3/pro/reference-to-video', mode: 'P2V', referenceStrategy: 'elements', resolutionOptions: [], ...ratios(), promptMaxLength: 2500 },
  { key: 'kling-v4-flash-reference', id: 'kling/v4/flash/reference-to-video', mode: 'P2V', referenceStrategy: 'elements', resolutionOptions: ['720p'], ...ratios(['16:9', '21:9']), promptMaxLength: 26000 },
  { key: 'h3-reference', id: 'minimax/h3-max/reference-to-video', mode: 'P2V', referenceStrategy: 'flat', resolutionOptions: ['768P', '1080P'], ...ratios(['16:9', '4:3', '21:9'], ['9:16', '3:4']), promptMaxLength: 50000 },
  { key: 'vidu-q4-reference', id: 'fal-ai/vidu/q4/reference-to-video', mode: 'P2V', referenceStrategy: 'flat', resolutionOptions: ['720p', '1080p'], ...ratios(['16:9', '4:3'], ['9:16', '3:4']), promptMaxLength: 5000 },
  { key: 'gemini-omni-reference', id: 'google/gemini-omni-flash/v1.2/reference-to-video', mode: 'P2V', referenceStrategy: 'flat', resolutionOptions: ['720p', '1080p'], ...ratios(), promptMaxLength: 20000 },
];

const sequence = (count, start = 0) => Array.from({ length: count }, (_, i) => i + start);
const lines = (...paragraphs) => `${paragraphs.flat().filter(Boolean).join('\n\n')}\n`;
function referenceLimit(model, people, photos) {
  if (model.referenceStrategy === 'recast') return 0;
  const group = people === 'group';
  if (model.key.startsWith('kling-v4')) return 10 - (group ? photos : 0);
  if (model.referenceStrategy === 'elements') {
    const budget = model.key === 'kling-o3-reference' ? 7 : 4;
    return budget - (group ? photos : people);
  }
  const budget = { 'h3-reference': 9, 'vidu-q4-reference': 12, 'gemini-omni-reference': 10 }[model.key];
  return budget - (group ? photos : people * photos);
}

function klingPrompt(key, people, photos, additional) {
  const group = people === 'group';
  const refs = (count, start = 1) => sequence(count, start).map(n => `@Image${n}`).join(', ');
  const groupRefs = group ? refs(photos) : '';
  const sceneRefs = refs(additional, group ? photos + 1 : 1);
  const subject = (one, two, many) => group ? many : people === 1 ? one : two;
  const optional = text => additional ? text : '';
  switch (key) {
    case 'kling-o1-edit':
      return lines(
        'Edit the source video.',
        subject(
          "Replace the main person in the source video with @Element1. Preserve the person's facial identity and appearance throughout the clip.",
          'Replace the left main person in the source video with @Element1 and the right main person with @Element2, using their positions at the first shared appearance. Keep the two identities distinct throughout the clip.',
          `Use ${groupRefs} as ${photos === 1 ? 'a photograph of the group' : 'different photographs of the same group'}. Recreate that group in the source video's scene, preserving the visible people's individual appearances and their relative arrangement. Do not interpret reference photographs as additional people.`,
        ),
        optional(`Use ${sceneRefs} only for compatible prop and appearance details within the existing environment. Keep the source video's setting and do not introduce additional main characters.`),
        'Preserve the source environment, camera movement, action timing, and shot sequence. Keep faces stable and avoid merging or duplicating people.',
      );
    case 'kling-o3-edit':
      return lines(
        'Edit @Video1.',
        subject(
          "Replace the main person in @Video1 with @Element1. Preserve this person's facial identity and appearance in every shot.",
          'Replace the left main person in @Video1 with @Element1 and the right main person with @Element2, based on their first shared appearance. Maintain these identities throughout the video and keep them distinct.',
          `Use ${groupRefs} as ${photos === 1 ? 'a reference view of the group' : 'multiple views of the same group'}. Recreate the group in @Video1, preserving the visible people's individual appearances and relative arrangement. The reference photographs represent one group, not additional groups.`,
        ),
        optional(`Use ${sceneRefs} only for compatible prop and appearance details within the existing environment. Keep the setting of @Video1 and do not introduce additional main characters.`),
        "Preserve the source video's environment, action timing, camera movement, and shot sequence. Preserve each person's identity and avoid duplicated people or merged faces.",
      );
    case 'kling-o3-reference':
      return lines(
        subject(
          'The main character is @Element1. Use all views within that element as references for the same person and preserve their facial identity and appearance.',
          'The two main characters are @Element1 and @Element2. The views within each element show the same person. Keep their identities distinct and preserve their individual facial features and appearance.',
          `The main subjects are the group shown in ${groupRefs}. ${photos === 1 ? 'This photograph depicts the group' : 'These photographs depict the same group'}. Preserve each visible person's appearance and the group's relative arrangement without duplicating people.`,
        ),
        'Create a calm cinematic portrait with subtle natural movement and a gentle camera move.',
        optional(`Use ${sceneRefs} as visual references for the setting, props, and style. They are not additional main characters.`),
        'Keep the subjects recognizable throughout the clip, with coherent natural motion. Avoid merging faces or adding duplicate main characters.',
      );
    case 'kling-v4-edit':
      return lines(
        'Edit @Video1.',
        subject(
          "Replace the main person in @Video1 with @Element1. Keep this person's facial identity and appearance consistent throughout the clip.",
          'Replace the two main people in @Video1 with @Element1 and @Element2 respectively, ordered from left to right in the first shot where they appear together. Keep their identities distinct throughout the clip.',
          `Use ${groupRefs} as ${photos === 1 ? 'a reference view of the group' : 'views of the same group of people'}. Replace the main group in @Video1 with this group, keeping each person's appearance distinct and the group membership consistent.`,
        ),
        'Preserve the source action, timing, camera movement, environment and scene continuity.',
        optional(`Use ${sceneRefs} for compatible visual details while retaining the source environment, action and camera movement.`),
        'Keep the people recognizable and anatomically coherent. Do not merge identities or duplicate the referenced people.',
      );
    case 'kling-v4-flash-edit':
      return lines(
        'Edit @Video1.',
        subject(
          "Replace the main person in @Video1 with @Element1. Maintain this person's facial identity and appearance throughout the clip.",
          "Replace the two main people in @Video1 with @Element1 and @Element2 respectively, ordered from left to right in the first shot where they appear together. Preserve each person's distinct identity.",
          `Use ${groupRefs} as ${photos === 1 ? 'a reference view of the group' : 'different views of the same group'}. Replace the main group in @Video1 with these people, retaining their distinct appearances and the same group membership.`,
        ),
        'Preserve the source motion, timing, camera movement, environment and scene continuity.',
        optional(`Use ${sceneRefs} for compatible visual details while retaining the source environment, action and camera movement.`),
        'Maintain coherent bodies and distinct faces. Do not merge or duplicate the referenced people.',
      );
    case 'kling-v4-reference':
      return lines(
        'Create a cinematic portrait video with subtle natural movement.',
        subject(
          "The main person is @Element1. Preserve this person's facial identity and appearance throughout the video.",
          'The two main people are @Element1 and @Element2. Preserve their distinct facial identities and appearances throughout the video.',
          `Use ${groupRefs} as ${photos === 1 ? 'a reference view of the group' : 'different views of the same group of people'}. Feature this same group and keep each person's appearance distinct; do not interpret the reference photographs as different groups.`,
        ),
        optional(`Use ${sceneRefs} as visual references for the setting and visual details of this scene.`),
        'Maintain consistent identities and natural, coherent motion. Do not merge or duplicate the referenced people.',
      );
    case 'kling-v4-flash-reference':
      return lines(
        'Create a cinematic portrait video with subtle natural movement.',
        subject(
          "Feature @Element1 as the main person, preserving this person's facial identity and appearance.",
          'Feature @Element1 and @Element2 as two distinct people. Preserve their individual facial identities and appearances.',
          `Use ${groupRefs} as ${photos === 1 ? 'a reference view of the group' : 'different views of the same group'}. Feature these people together and maintain the same group membership and distinct appearances; the reference photographs do not represent separate groups.`,
        ),
        optional(`Use ${sceneRefs} as visual references for the setting and visual details of the scene.`),
        'Keep the people recognizable with coherent anatomy and natural movement. Avoid merging identities or duplicating the referenced people.',
      );
    default: throw new Error(`Unsupported Kling prompt: ${key}`);
  }
}

function flatPrompt(key, people, photos, additional) {
  const tokens = {
    'h3-reference': i => `Image ${i + 1}`,
    'vidu-q4-reference': i => `[@reference_image_${i + 1}]`,
    'gemini-omni-reference': i => `<IMAGE_REF_${i}>`,
  };
  const refs = (count, start = 0) => sequence(count, start).map(tokens[key]).join(', ');
  const group = people === 'group';
  const cameraPhotos = group ? photos : people * photos;
  const identity = [];
  if (group) {
    const peopleInstructions = {
      'h3-reference': "Keep the group members together and preserve each visible member's appearance. Do not add or duplicate people.",
      'vidu-q4-reference': 'Show these group members together, preserving their individual appearances. Do not add or duplicate people.',
      'gemini-omni-reference': "Keep these people together and preserve each visible group member's appearance. Do not add or duplicate people.",
    };
    identity.push(`Use ${refs(photos)} as ${photos === 1 ? 'a reference photograph of the group' : 'reference photographs of the same group'}. ${peopleInstructions[key]}`);
  } else {
    for (let person = 1; person <= people; person++) {
      const personRefs = refs(photos, (person - 1) * photos);
      identity.push(`Use ${personRefs} as ${photos === 1 ? 'a reference view' : 'different supplied views'} of the same person, Person ${person}. Portray this person once, using the supplied ${photos === 1 ? 'view' : 'views'} to preserve their appearance.`);
    }
    identity.push("Preserve each person's appearance from their own reference images. Keep their identities separate and do not merge faces or duplicate a person.");
  }
  const scene = additional ? `Use ${refs(additional, cameraPhotos)} as visual references for the environment, objects and style. They are not additional main characters.` : '';
  const endings = {
    'h3-reference': 'Keep the subjects recognizable throughout the shot, with natural movement and coherent anatomy.',
    'vidu-q4-reference': 'Use natural movement and keep the subjects recognizable for the whole clip.',
    'gemini-omni-reference': 'Create coherent natural movement while keeping the subjects recognizable throughout the video.',
  };
  return lines(identity, scene, 'Create a neutral cinematic portrait with subtle natural movement.', endings[key]);
}

const files = new Map();
let captureCount = 0;
const catalog = {
  version: 1,
  source: 'docs/slot-setup/matrix.md',
  promptBaseUrl: '/slot-prompts/',
  models: models.map(model => {
    const captureVariants = [];
    const participants = model.referenceStrategy === 'recast' ? [1, 2] : [1, 2, 'group'];
    for (const people of participants) {
      const counts = model.referenceStrategy === 'recast' ? [1]
        : model.referenceStrategy === 'elements' && people !== 'group' ? [2, 3, 4] : [1, 2, 3, 4];
      for (const photos of counts) {
        const additionalReferenceLimit = referenceLimit(model, people, photos);
        const promptFiles = [];
        for (let additional = 0; additional <= additionalReferenceLimit; additional++) {
          const file = `${model.key}/${people === 'group' ? 'group' : `people-${people}`}__photos-${photos}__refs-${additional}.md`;
          const prompt = model.referenceStrategy === 'recast' ? ''
            : model.referenceStrategy === 'elements' ? klingPrompt(model.key, people, photos, additional)
              : flatPrompt(model.key, people, photos, additional);
          if (prompt.length > model.promptMaxLength || /[{}]|SUBJECT_INSTRUCTION|GROUP_REFS|SCENE_REFS|identity_block|scene_description/.test(prompt)) {
            throw new Error(`Invalid materialized prompt: ${file}`);
          }
          if (files.has(file)) throw new Error(`Duplicate prompt path: ${file}`);
          files.set(file, prompt);
          promptFiles.push(file);
        }
        captureVariants.push({
          participants: people, photosPerParticipant: photos,
          cameraPhotos: people === 'group' ? photos : people * photos,
          elementsCount: model.referenceStrategy === 'elements' && people !== 'group' ? people : 0,
          additionalReferenceLimit, promptFiles,
        });
        captureCount++;
      }
    }
    return { ...model, captureVariants };
  }),
};
if (captureCount !== 108 || files.size !== 813) throw new Error(`Incomplete catalog: ${captureCount} captures, ${files.size} prompts`);
const expected = new Map([[matrixPath, `${JSON.stringify(catalog, null, 2)}\n`],
  ...Array.from(files, ([path, text]) => [join(assetRoot, path), text])]);

async function assetFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true }).catch(error => {
    if (error.code === 'ENOENT') return [];
    throw error;
  });
  const paths = [];
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) paths.push(...await assetFiles(path));
    else if (entry.isFile()) paths.push(path);
  }
  return paths;
}

if (check) {
  const problems = [];
  for (const [path, text] of expected) {
    const actual = await readFile(path, 'utf8').catch(error => {
      if (error.code === 'ENOENT') return undefined;
      throw error;
    });
    if (actual !== text) problems.push(relative(root, path));
  }
  for (const path of await assetFiles(assetRoot)) if (!expected.has(path)) problems.push(`Unexpected asset: ${relative(root, path)}`);
  if (problems.length) throw new Error(`Catalog differs from authoring source:\n${problems.join('\n')}`);
} else {
  for (const [path, text] of expected) {
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, text, 'utf8');
  }
}
console.log(`${check ? 'Verified' : 'Materialized'} ${catalog.models.length} models, ${captureCount} capture variants, ${files.size} ready Markdown prompts (${[...files.values()].filter(text => text === '').length} empty Recast files).`);
