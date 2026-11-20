import { createAvatar } from './avatar.js';

const byId = id => document.getElementById(id);
const avatar = createAvatar(byId('avatar'));
const status = byId('status');
const input = byId('question');
const messages = byId('messages');
const composer = byId('composer');
const audioToggle = byId('audio-toggle');
const stopButton = byId('stop-audio');
const dictate = byId('dictate');
const send = composer.querySelector('[type="submit"]');

const storageKey = 'dr-constitucional.history.v1';
const phoneKey = 'dr-constitucional.phone.v1';
const voiceKey = 'dr-constitucional.voice.v1';
const greeting = '¡Hola! Soy el Dr. Constitucional IA. Contame qué tema jurídico querés consultar.';
let history = [];
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) history = saved.filter(chat => chat?.id && Array.isArray(chat.turns));
} catch {
  status.textContent = 'No se pudo recuperar el historial local.';
}

let chat;
let busy = false;
let audioEnabled = true;
let audioContext;
let playback;
let speechRequest;
let recorder;
let processingDictation = false;
let sharedText = '';
let configRequest;
let voicePreference = {};

try {
  voicePreference = JSON.parse(localStorage.getItem(voiceKey) || '{}') || {};
} catch {}

async function api(path, options) {
  const response = await fetch('/api/' + path, options);
  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || 'No se pudo completar la operación.');
  }
  return response;
}

function post(path, body, signal) {
  return api(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal
  });
}

function getConfig() {
  configRequest ??= api('config').then(response => response.json()).catch(error => {
    configRequest = undefined;
    throw error;
  });
  return configRequest;
}

const keyRequired = 'Agregá tu clave de OpenAI en Configuración.';

function persist() {
  try {
    localStorage.setItem(storageKey, JSON.stringify(history));
    return true;
  } catch {
    status.textContent = 'No hay espacio o permiso para guardar el historial en este navegador.';
    return false;
  }
}

function button(label, onClick) {
  const element = document.createElement('button');
  element.type = 'button';
  element.textContent = label;
  element.addEventListener('click', onClick);
  return element;
}

function actionText(turn) {
  return turn.sources?.length
    ? turn.text + '\n\nFuentes: ' + turn.sources.join(', ')
    : turn.text;
}

function openShare(turn) {
  sharedText = actionText(turn);
  let saved = '';
  try { saved = localStorage.getItem(phoneKey) || ''; } catch {}
  byId('phone').value = saved;
  byId('share-note').textContent = saved
    ? '¿Usar el número guardado? Podés cambiarlo antes de continuar.'
    : 'Guardaremos este número en este navegador para la próxima vez.';
  byId('share').showModal();
}

function buildMessage(turn) {
  const article = document.createElement('article');
  article.className = 'message ' + (turn.role === 'user' ? 'user' : 'assistant');
  const author = document.createElement('strong');
  author.textContent = turn.role === 'user' ? 'Vos' : 'Dr. Constitucional IA';
  const body = document.createElement('p');
  body.textContent = turn.text;
  article.append(author, body);
  if (turn.sources?.length) {
    const sources = document.createElement('p');
    sources.className = 'sources';
    sources.textContent = 'Fuentes consultadas: ' + turn.sources.join(', ');
    article.append(sources);
  }
  if (turn.role === 'assistant' && !turn.greeting) {
    const actions = document.createElement('footer');
    actions.append(button('Copiar', async () => {
      try {
        await navigator.clipboard.writeText(actionText(turn));
        status.textContent = 'Respuesta copiada.';
      } catch {
        status.textContent = 'No se pudo copiar. Podés seleccionar el texto manualmente.';
      }
    }), button('WhatsApp', () => openShare(turn)));
    article.append(actions);
  }
  return article;
}

function renderHistory() {
  const list = byId('history');
  list.replaceChildren();
  for (const entry of history) {
    const row = document.createElement('li');
    const title = entry.turns.find(turn => turn.role === 'user')?.text.slice(0, 66)
      || 'Nueva conversación';
    const item = button(title, () => {
      if (busy || processingDictation || recorder) return;
      stopSpeech();
      chat = entry;
      input.value = '';
      status.textContent = '';
      renderChat();
    });
    item.setAttribute('aria-current', String(entry === chat));
    row.append(item);
    list.append(row);
  }
}

function appendTurn(turn) {
  chat.turns.push(turn);
  messages.append(buildMessage(turn));
  messages.scrollTop = messages.scrollHeight;
  renderHistory();
  persist();
}

function renderChat() {
  byId('welcome').hidden = Boolean(chat);
  composer.hidden = !chat;
  messages.replaceChildren(...(chat?.turns || []).map(buildMessage));
  messages.scrollTop = messages.scrollHeight;
  renderHistory();
}

function stopSpeech() {
  speechRequest?.abort();
  speechRequest = undefined;
  if (playback) {
    playback.onended = null;
    playback.stop();
    playback.disconnect();
    playback = undefined;
  }
  avatar.connect();
  stopButton.hidden = true;
}

function unlockAudio() {
  if (!audioEnabled) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
  } catch {
    status.textContent = 'Este navegador no pudo activar el audio.';
  }
}

async function speak(text) {
  if (!audioEnabled || !audioContext) return;
  stopSpeech();
  const controller = new AbortController();
  speechRequest = controller;
  stopButton.hidden = false;
  try {
    const response = await post('speech', {
      text: text.replace(/\[\d+\]/g, '').slice(0, 4096),
      voice: voicePreference.voice,
      accent: voicePreference.accent
    }, controller.signal);
    const decoded = await audioContext.decodeAudioData(await response.arrayBuffer());
    if (controller.signal.aborted) return;
    const source = audioContext.createBufferSource();
    const analyser = audioContext.createAnalyser();
    source.buffer = decoded;
    source.connect(analyser).connect(audioContext.destination);
    avatar.connect(analyser);
    playback = source;
    source.onended = () => {
      analyser.disconnect();
      source.disconnect();
      playback = undefined;
      speechRequest = undefined;
      avatar.connect();
      stopButton.hidden = true;
    };
    controller.signal.addEventListener('abort', () => analyser.disconnect(), { once: true });
    source.start();
  } catch (error) {
    if (controller.signal.aborted) return;
    stopSpeech();
    status.textContent = error.message;
  }
}

byId('start').addEventListener('click', async () => {
  if (chat) return;
  unlockAudio();
  status.textContent = '';
  chat = { id: crypto.randomUUID(), turns: [] };
  const startedChat = chat;
  history.unshift(chat);
  renderChat();
  appendTurn({ role: 'assistant', text: greeting, greeting: true });
  input.focus();
  try {
    const config = await getConfig();
    if (config.configured && chat === startedChat && chat.turns.length === 1 && !busy && !recorder && !processingDictation) {
      void speak(greeting);
    }
    if (!config.configured) status.textContent = keyRequired;
  } catch (error) {
    status.textContent = error.message;
  }
});

byId('new-chat').addEventListener('click', () => {
  if (busy || processingDictation || recorder) return;
  stopSpeech();
  chat = undefined;
  status.textContent = '';
  input.value = '';
  renderChat();
  byId('start').focus();
});

audioToggle.addEventListener('click', () => {
  audioEnabled = !audioEnabled;
  audioToggle.textContent = audioEnabled ? 'Voz activada' : 'Voz desactivada';
  audioToggle.setAttribute('aria-pressed', String(audioEnabled));
  if (!audioEnabled) stopSpeech();
  else unlockAudio();
});

stopButton.addEventListener('click', stopSpeech);

composer.addEventListener('submit', async event => {
  event.preventDefault();
  const question = input.value.trim();
  if (!chat || !question || busy || recorder || processingDictation) return;
  unlockAudio();
  stopSpeech();
  busy = true;
  send.disabled = true;
  dictate.disabled = true;
  const context = chat.turns.filter(turn => !turn.greeting && !turn.pending).slice(-20);
  const turn = { role: 'user', text: question, pending: true };
  const previous = chat.turns.at(-1);
  if (previous?.pending && previous.text === question) {
    chat.turns.pop();
    messages.lastElementChild?.remove();
  }
  appendTurn(turn);
  input.value = '';
  status.textContent = 'Preparando la respuesta…';
  try {
    const answer = await (await post('chat', { question, history: context })).json();
    delete turn.pending;
    status.textContent = '';
    appendTurn({ role: 'assistant', ...answer });
    void speak(answer.text);
  } catch (error) {
    if (!input.value) input.value = question;
    status.textContent = error.message;
  } finally {
    busy = false;
    send.disabled = false;
    dictate.disabled = false;
  }
});

dictate.addEventListener('click', async () => {
  if (recorder) {
    if (recorder.state === 'recording') recorder.stop();
    return;
  }
  if (busy || processingDictation) return;
  stopSpeech();
  processingDictation = true;
  dictate.disabled = true;
  send.disabled = true;
  let stream;
  try {
    const config = await getConfig();
    if (!config.configured) throw new Error(keyRequired);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('El micrófono requiere un navegador compatible y un origen local seguro.');
    }
    const formats = [
      ['webm', 'audio/webm;codecs=opus'], ['mp4', 'audio/mp4'], ['ogg', 'audio/ogg;codecs=opus']
    ];
    const format = formats.find(([, type]) => MediaRecorder.isTypeSupported(type));
    if (!format) throw new Error('El navegador no admite los formatos de grabación disponibles.');
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    recorder = new MediaRecorder(stream, { mimeType: format[1], audioBitsPerSecond: 96_000 });
    const chunks = [];
    recorder.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    recorder.onstop = async () => {
      clearTimeout(limit);
      stream.getTracks().forEach(track => track.stop());
      dictate.disabled = true;
      dictate.textContent = 'Dictar';
      status.textContent = 'Transcribiendo…';
      try {
        const audio = new Blob(chunks, { type: format[1] });
        if (audio.size > config.audioLimit) {
          throw new Error('La grabación supera el límite de carga. Probá con un dictado más corto.');
        }
        const result = await api('transcribe?format=' + format[0], {
          method: 'POST',
          body: audio
        });
        const { text } = await result.json();
        const transcript = (text || '').trim();
        if (!transcript) throw new Error('No se detectó texto en el dictado.');
        input.value = [input.value.trim(), transcript].filter(Boolean).join(' ').slice(0, input.maxLength);
        status.textContent = 'Dictado listo para revisar y enviar.';
        input.focus();
      } catch (error) {
        status.textContent = error.message;
      } finally {
        recorder = undefined;
        processingDictation = false;
        dictate.disabled = false;
        send.disabled = false;
      }
    };
    recorder.start();
    const limit = setTimeout(() => {
      if (recorder?.state === 'recording') recorder.stop();
    }, 120_000);
    dictate.textContent = 'Terminar dictado';
    dictate.disabled = false;
    status.textContent = 'Grabando…';
  } catch (error) {
    stream?.getTracks().forEach(track => track.stop());
    recorder = undefined;
    processingDictation = false;
    dictate.disabled = false;
    send.disabled = false;
    status.textContent = error.name === 'NotAllowedError' ? 'Permití el uso del micrófono para dictar.' : error.message;
  }
});

const settingsForm = byId('settings-form');
const configStatus = byId('settings-status');
const saveConfig = settingsForm.querySelector('[type="submit"]');

function showConfig(config) {
  byId('api-key').value = '';
  byId('key-note').textContent = config.hosted
    ? (config.configured ? 'Ya hay una clave cifrada para este navegador. Dejá el campo vacío para conservarla.'
      : 'La app guarda la clave cifrada para este navegador.')
    : (config.configured ? 'Ya hay una clave guardada. Dejá el campo vacío para conservarla.'
      : 'La clave se guarda en el servidor local.');
  for (const field of ['voice', 'accent']) {
    const select = byId(field);
    const preference = config.hosted && voicePreference[field];
    select.value = Array.from(select.options).some(option => option.value === preference)
      ? preference : config[field];
  }
}

byId('open-settings').addEventListener('click', async () => {
  byId('settings').showModal();
  configStatus.textContent = '';
  saveConfig.disabled = true;
  try {
    showConfig(await getConfig());
    saveConfig.disabled = false;
  } catch (error) {
    configStatus.textContent = error.message;
  }
});

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  configStatus.textContent = 'Guardando…';
  saveConfig.disabled = true;
  try {
    const config = await getConfig();
    const preferences = { voice: byId('voice').value, accent: byId('accent').value };
    const response = await post('config', { ...preferences, key: byId('api-key').value.trim() });
    const updated = await response.json();
    configRequest = Promise.resolve(updated);
    if (config.hosted) {
      voicePreference = preferences;
      try { localStorage.setItem(voiceKey, JSON.stringify(preferences)); } catch {}
    }
    showConfig(updated);
    configStatus.textContent = 'Configuración guardada.';
    status.textContent = '';
  } catch (error) {
    configStatus.textContent = error.message;
  } finally {
    saveConfig.disabled = false;
  }
});

const libraryStatus = byId('library-status');
const refreshButton = byId('refresh-library');
const uploadForm = byId('upload-form');

async function refreshLibrary() {
  refreshButton.disabled = true;
  libraryStatus.textContent = 'Cargando biblioteca…';
  try {
    const config = await getConfig();
    uploadForm.hidden = !config.libraryConfigured;
    if (!config.libraryConfigured) {
      libraryStatus.textContent = 'La biblioteca todavía necesita un índice configurado en Vercel.';
      return;
    }
    byId('document-note').textContent = 'PDF, DOCX, TXT o Markdown de hasta '
      + config.documentLimit / (1024 * 1024) + ' MB. El archivo se enviará a OpenAI para indexarlo.';
    const files = await (await api('documents')).json();
    const labels = { completed: 'Indexado', in_progress: 'Indexando', failed: 'Error de indexación', cancelled: 'Cancelado' };
    byId('documents').replaceChildren(...files.map(file => {
      const row = document.createElement('li');
      row.textContent = file.name + ' · ' + (labels[file.status] || file.status);
      return row;
    }));
    libraryStatus.textContent = files.length ? '' : 'Todavía no hay documentos.';
  } catch (error) {
    libraryStatus.textContent = error.message;
  } finally {
    refreshButton.disabled = false;
  }
}

byId('open-library').addEventListener('click', () => {
  byId('library').showModal();
  void refreshLibrary();
});
refreshButton.addEventListener('click', refreshLibrary);

uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = event.submitter;
  const selector = byId('document');
  const [file] = selector.files;
  if (!file) return;
  submit.disabled = true;
  refreshButton.disabled = true;
  libraryStatus.textContent = 'Enviando documento para indexar…';
  try {
    const { documentLimit } = await getConfig();
    if (file.size > documentLimit) {
      throw new Error('Elegí un archivo de hasta ' + documentLimit / (1024 * 1024) + ' MB.');
    }
    await api('documents?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
    selector.value = '';
    await refreshLibrary();
  } catch (error) {
    libraryStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
    refreshButton.disabled = false;
  }
});

byId('share-form').addEventListener('submit', event => {
  event.preventDefault();
  const phoneInput = byId('phone');
  const phone = phoneInput.value.replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) {
    byId('share-note').textContent = 'Ingresá un número válido con código de país.';
    phoneInput.focus();
    return;
  }
  try { localStorage.setItem(phoneKey, '+' + phone); } catch {}
  window.open('https://wa.me/' + phone + '?text=' + encodeURIComponent(sharedText), '_blank', 'noopener,noreferrer');
  byId('share').close();
});

document.querySelectorAll('[data-close]').forEach(control => {
  control.addEventListener('click', () => control.closest('dialog').close());
});

renderChat();
