import { randomUUID } from 'node:crypto';
import { mkdir, rename, unlink, writeFile } from 'node:fs/promises';
import { liveSpeech } from '../live-voice.mjs';
import { accents, voicePreviewDirectory, voices } from '../voice-presets.mjs';

const key = process.env.OPENAI_API_KEY?.trim();
if (!key) {
  process.exitCode = 1;
  console.error('Configura OPENAI_API_KEY con acceso a GPT-Live antes de generar las muestras.');
} else {
  const directory = new URL('../public/' + voicePreviewDirectory + '/', import.meta.url);
  await mkdir(directory, { recursive: true });
  for (const voice of voices) {
    for (const [accent, preset] of Object.entries(accents)) {
      const filename = voice + '-' + accent + '.mp3';
      const temporary = new URL('.' + randomUUID(), directory);
      try {
        const audio = await liveSpeech(key, {
          voice, instructions: preset.delivery + ' ' + preset.address, text: preset.greeting
        });
        if (!audio.length) throw new Error('El proveedor devolvió una muestra vacía.');
        await writeFile(temporary, audio);
        await rename(temporary, new URL(filename, directory));
        console.log(filename);
      } catch (error) {
        process.exitCode = 1;
        console.error(filename + ' — ' + error.message);
      } finally {
        await unlink(temporary).catch(() => {});
      }
    }
  }
}
