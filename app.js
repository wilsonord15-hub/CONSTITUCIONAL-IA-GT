import { createAvatar } from './avatar.js';
import { createLiveCall } from './live-call.js';

const byId = id => document.getElementById(id);
const avatar = createAvatar(byId('avatar'), () => busy || processingDictation || Boolean(speechRequest));
const status = byId('status');
const micWave = byId('mic-wave');
const input = byId('question');
const messages = byId('messages');
const composer = byId('composer');
const audioToggle = byId('audio-toggle');
const stopButton = byId('stop-audio');
const previewVoice = byId('preview-voice');
const previewLabel = byId('preview-voice-label');
const previewStatus = byId('voice-preview-status');
const dictate = byId('dictate');
const dictationPreview = byId('dictation-preview');
const dictationText = byId('dictation-preview-text');
const send = composer.querySelector('[type="submit"]');
const switchToVoice = byId('switch-to-voice');
const switchToText = byId('switch-to-text');
const muteCall = byId('mute-call');
const activateCallAudio = byId('activate-call-audio');
const liveAudio = byId('live-audio');
const historyList = byId('history');
const historyRecent = byId('history-recent');
const historyArchived = byId('history-archived');
const historyStatus = byId('history-status');
const deleteConversation = byId('delete-conversation');
const deleteStatus = byId('delete-status');

const storageKey = 'dr-constitucional.history.v1';
const phoneKey = 'dr-constitucional.phone.v1';
const voiceKey = 'dr-constitucional.voice.v1';
const profileKey = 'dr-constitucional.profile.v1';
const greetingContinuation = ' Soy el Dr. Constitucional IA. Cuéntame qué tema jurídico quieres consultar.';

function firstQuestion(entry) {
  return entry.turns.find(turn => turn?.role === 'user' && typeof turn.text === 'string' && turn.text.trim());
}

let history = [];
let viewingArchived = false;
let conversationToDelete;
try {
  const saved = JSON.parse(localStorage.getItem(storageKey) || '[]');
  if (Array.isArray(saved)) {
    history = saved.filter(entry => entry?.id && Array.isArray(entry.turns) && firstQuestion(entry));
  }
} catch {
  status.textContent = 'No se pudo recuperar el historial local.';
}

let chat;
let busy = false;
let audioEnabled = true;
let audioContext;
let playback;
let speechRequest;
let previewingVoice = false;
let recorder;
let processingDictation = false;
let voiceSession;
let sharedText = '';
let configRequest;
let voicePreference = {};

try {
  voicePreference = JSON.parse(localStorage.getItem(voiceKey) || '{}') || {};
} catch {}

let visitorProfile;
try {
  const saved = JSON.parse(localStorage.getItem(profileKey) || 'null');
  if (saved && typeof saved === 'object' && !Array.isArray(saved)) visitorProfile = saved;
} catch {}

const profileDialog = byId('profile-dialog');
const profileForm = byId('profile-form');
const profileStatus = byId('profile-status');
const profileName = byId('profile-name');
const profileFields = {
  name: profileName,
  role: byId('profile-role'),
  detail: byId('profile-detail'),
  goal: byId('profile-goal')
};

function openProfile(firstVisit) {
  leaveVoiceMode();
  byId('profile-title').textContent = firstVisit ? 'Personaliza tu consulta' : 'Mi perfil';
  byId('skip-profile').hidden = !firstVisit;
  byId('cancel-profile').hidden = firstVisit;
  profileStatus.textContent = '';
  for (const [name, field] of Object.entries(profileFields)) {
    field.value = typeof visitorProfile?.[name] === 'string' ? visitorProfile[name] : '';
  }
  profileDialog.hidden = false;
  renderChat();
  if (!firstVisit) profileName.focus();
}

function closeProfile() {
  profileDialog.hidden = true;
  renderChat();
  (chat ? input : byId('start')).focus();
}

function storeProfile(profile) {
  visitorProfile = profile;
  try {
    localStorage.setItem(profileKey, JSON.stringify(profile));
  } catch {
    status.textContent = 'Tu navegador no pudo guardar el perfil. Solo estará disponible durante esta visita.';
  }
}

byId('open-profile').addEventListener('click', () => openProfile(false));
byId('cancel-profile').addEventListener('click', closeProfile);
byId('skip-profile').addEventListener('click', () => {
  storeProfile({});
  closeProfile();
});
profileForm.addEventListener('submit', event => {
  event.preventDefault();
  const profile = Object.fromEntries(Object.entries(profileFields).map(([name, field]) => [
    name, field.value.trim().replace(/\s+/g, ' ')
  ]));
  if (!profile.name) {
    profileStatus.textContent = 'Escribe el nombre o apodo que quieres usar.';
    profileName.focus();
    return;
  }
  storeProfile(profile);
  closeProfile();
});

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

const keyRequired = 'Agrega tu clave de OpenAI en Configuración.';

function persist(entries = history, feedback = status) {
  try {
    localStorage.setItem(storageKey, JSON.stringify(entries));
    return true;
  } catch {
    feedback.textContent = 'No hay espacio o permiso para guardar el historial en este navegador.';
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

function iconLabel(element, glyph, label) {
  const icon = document.createElement('span');
  icon.className = 'icon';
  icon.setAttribute('aria-hidden', 'true');
  icon.textContent = glyph;
  element.replaceChildren(icon, document.createTextNode(' ' + label));
}

function plainMessage(text) {
  return text.replace(/\r\n?/g, '\n')
    .replace(/^[ \t]*(?:\x60{3,}|~{3,}).*$/gm, '')
    .replace(/^[ \t]*(?:>[ \t]*)+/gm, '')
    .replace(/^[ \t]{0,3}#{1,6}[ \t]+(.+?)(?:[ \t]+#+)?$/gm, '$1')
    .replace(/^[ \t]*(?:-{3,}|\*{3,}|_{3,})[ \t]*$/gm, '')
    .replace(/^[ \t]*\|?(?:[ \t]*:?-{3,}:?[ \t]*\|)+[ \t]*(?::?-{3,}:?)?[ \t]*$/gm, '')
    .replace(/^[ \t]*\|(.+)\|[ \t]*$/gm, (_, row) => row.split('|').map(cell => cell.trim()).join(' · '))
    .replace(/^([ \t]*)[-+*][ \t]+/gm, '$1• ')
    .replace(/^([ \t]*\d+)[.)][ \t]+/gm, '$1) ')
    .replace(/!?\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, label, url) =>
      label === url ? url : label + ' (' + url + ')')
    .replace(/\x60+([^\x60\n]+)\x60+/g, '$1')
    .replace(/(\*\*\*|___|\*\*|__|~~)([^\n]+?)\1/g, '$2')
    .replace(/(^|[^\p{L}\p{N}_])([*_~])(\S(?:[^\n]*?\S)?)\2(?![\p{L}\p{N}_])/gmu, '$1$3')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function actionText(turn) {
  const text = plainMessage(turn.text);
  return turn.sources?.length
    ? text + '\n\nFuentes consultadas\n' + turn.sources.map(source => '• ' + source).join('\n')
    : text;
}

function openShare(turn) {
  sharedText = actionText(turn);
  let saved = '';
  try { saved = localStorage.getItem(phoneKey) || ''; } catch {}
  byId('phone').value = saved;
  byId('share-note').textContent = saved
    ? '¿Usar el número guardado? Puedes cambiarlo antes de continuar.'
    : 'Guardaremos este número en este navegador para la próxima vez.';
  byId('share-preview').textContent = sharedText;
  byId('share').showModal();
}

function buildMessage(turn) {
  const article = document.createElement('article');
  article.className = 'message ' + (turn.role === 'user' ? 'user' : 'assistant');
  const author = document.createElement('strong');
  author.textContent = turn.role === 'user' ? 'Tú' : turn.libraryResult ? 'Biblioteca jurídica' : 'Dr. Constitucional IA';
  const body = document.createElement('p');
  const text = turn.greeting
    ? turn.text.replace(/ Soy el Dr\. Constitucional IA\..*$/, greetingContinuation)
    : turn.text;
  body.textContent = plainMessage(text);
  article.append(author, body);
  if (turn.sources?.length) {
    const sources = document.createElement('p');
    sources.className = 'sources';
    sources.textContent = 'Fuentes consultadas: ' + turn.sources.join(', ');
    article.append(sources);
  }
  for (const source of turn.evidence || []) {
    const details = document.createElement('details');
    details.className = 'source-evidence';
    const heading = document.createElement('summary');
    heading.textContent = source.name;
    details.append(heading);
    for (const excerpt of source.excerpts) {
      const quote = document.createElement('blockquote');
      quote.textContent = excerpt;
      details.append(quote);
    }
    article.append(details);
  }
  if (!turn.greeting) {
    const topic = turn.role === 'user' ? 'pregunta' : 'respuesta';
    const actions = document.createElement('footer');
    actions.className = 'message-actions';
    const copy = button('', async () => {
      try {
        await navigator.clipboard.writeText(actionText(turn));
        status.textContent = turn.role === 'user' ? 'Pregunta copiada.' : 'Respuesta copiada.';
      } catch {
        status.textContent = 'No se pudo copiar. Puedes seleccionar el texto manualmente.';
      }
    });
    const share = button('', () => openShare(turn));
    copy.setAttribute('aria-label', 'Copiar ' + topic);
    share.setAttribute('aria-label', 'Compartir ' + topic + ' por WhatsApp');
    copy.title = 'Copiar';
    share.title = 'Compartir por WhatsApp';
    copy.append(outlineIcon('copy'));
    share.append(outlineIcon('whatsapp'));
    actions.append(copy, share);
    article.append(actions);
  }
  return article;
}

const outlineIcons = {
  copy: 'M8 8h12v12H8zM16 4H4v12',
  whatsapp: 'M20.5 11.8a8.5 8.5 0 0 1-12.7 7.4L4 20l.9-3.7a8.5 8.5 0 1 1 15.6-4.5ZM9 8.4c.6-.5 1.1.5 1.4 1.1l-.8.9a6 6 0 0 0 3.8 3.3l.8-.9c.6.2 1.9.6 1.7 1.3-.2 1-1.2 1.6-2.2 1.4-3.5-.8-6-3.6-5.6-5.8.1-.6.4-1 .9-1.3Z',
  conversation: 'M7 8h10M7 12h6M4 4h16v12H9l-5 4V4Z',
  open: 'm9 6 6 6-6 6',
  archive: 'M4 8h16v12H4zM3 4h18v4H3zM9 12h6',
  restore: 'M4 5v6h6M4.8 10a8 8 0 1 1 .9 8',
  delete: 'M4 7h16M9 7V4h6v3m-9 0 1 13h10l1-13M10 10v7m4-7v7'
};

function outlineIcon(name) {
  const namespace = 'http://www.w3.org/2000/svg';
  const icon = document.createElementNS(namespace, 'svg');
  icon.setAttribute('viewBox', '0 0 24 24');
  icon.setAttribute('aria-hidden', 'true');
  icon.setAttribute('focusable', 'false');
  const outline = document.createElementNS(namespace, 'path');
  outline.setAttribute('d', outlineIcons[name]);
  icon.append(outline);
  return icon;
}

function conversationName(entry) {
  const question = firstQuestion(entry).text;
  return (plainMessage(question) || question).replace(/\s+/g, ' ').trim();
}

function historyAction(name, label, title, action) {
  const control = button('', action);
  control.className = 'history-action';
  control.title = label;
  control.setAttribute('aria-label', label + ' conversación: ' + title);
  control.append(outlineIcon(name));
  return control;
}

function canManageHistory(feedback = historyStatus) {
  if (!busy && !processingDictation && !recorder) return true;
  feedback.textContent = 'Termina la consulta o el dictado para continuar.';
  return false;
}

function setArchived(entry, archived) {
  if (!canManageHistory()) return false;
  const updated = { ...entry, archived };
  const next = history.map(item => item === entry ? updated : item);
  if (!persist(next, historyStatus)) return false;
  history = next;
  if (chat === entry) {
    leaveVoiceMode();
    stopSpeech();
    status.textContent = '';
    chat = updated;
    renderChat();
  } else {
    renderHistory();
  }
  historyStatus.textContent = archived ? 'Conversación archivada.' : 'Conversación restaurada.';
  return true;
}

function openDeleteConversation(entry, title) {
  if (!canManageHistory()) return;
  conversationToDelete = entry;
  byId('delete-name').textContent = title;
  deleteStatus.textContent = '';
  deleteConversation.showModal();
}

function selectHistoryView(archived) {
  viewingArchived = archived;
  historyStatus.textContent = '';
  renderHistory();
}

function currentHistoryFilter() {
  return viewingArchived ? historyArchived : historyRecent;
}

function renderHistory() {
  historyRecent.setAttribute('aria-pressed', String(!viewingArchived));
  historyArchived.setAttribute('aria-pressed', String(viewingArchived));
  historyList.replaceChildren();
  const entries = history.filter(entry => (entry.archived === true) === viewingArchived);
  if (!entries.length) {
    const empty = document.createElement('li');
    empty.className = 'muted history-empty';
    empty.textContent = viewingArchived ? 'Aún no hay conversaciones archivadas.' : 'Todavía no hay conversaciones.';
    historyList.append(empty);
  }
  for (const entry of entries) {
    const row = document.createElement('li');
    row.className = 'history-entry';
    const name = conversationName(entry);
    const title = name.length > 120 ? name.slice(0, 119) + '…' : name;
    const item = button('', () => {
      if (!canManageHistory()) return;
      leaveVoiceMode();
      stopSpeech();
      if (chat !== entry) input.value = '';
      chat = entry;
      status.textContent = '';
      renderChat();
      byId('chat-title').focus();
    });
    item.className = 'history-open';
    item.title = title;
    item.setAttribute('aria-label', 'Abrir conversación: ' + title);
    if (entry === chat) {
      item.setAttribute('aria-current', 'true');
      row.classList.add('history-current');
    }
    const nameLabel = document.createElement('span');
    nameLabel.textContent = title;
    item.append(outlineIcon('conversation'), nameLabel, outlineIcon('open'));

    const tools = document.createElement('div');
    tools.className = 'history-entry-tools';
    const count = entry.turns.filter(turn => turn?.role === 'user').length;
    const detail = document.createElement('span');
    detail.textContent = count === 1 ? '1 consulta' : count + ' consultas';
    const archive = historyAction(viewingArchived ? 'restore' : 'archive',
      viewingArchived ? 'Restaurar' : 'Archivar', title, () => {
        if (setArchived(entry, !viewingArchived)) currentHistoryFilter().focus();
      });
    const remove = historyAction('delete', 'Eliminar', title, () => openDeleteConversation(entry, title));
    remove.classList.add('history-remove');
    tools.append(detail, archive, remove);
    row.append(item, tools);
    historyList.append(row);
  }
}

function rememberConversation(turn) {
  if (turn.role === 'user' && history[0] !== chat) {
    const previous = history.indexOf(chat);
    if (previous !== -1) history.splice(previous, 1);
    history.unshift(chat);
  }
}

function appendTurn(turn) {
  chat.turns.push(turn);
  rememberConversation(turn);
  messages.append(buildMessage(turn));
  messages.scrollTop = messages.scrollHeight;
  renderHistory();
  if (history.includes(chat)) persist();
}

function renderChat() {
  const greeting = byId('visitor-greeting');
  greeting.hidden = !visitorProfile?.name;
  greeting.textContent = visitorProfile?.name ? '¡Hola, ' + visitorProfile.name + '!' : '';
  const editing = !profileDialog.hidden;
  const archived = chat?.archived === true;
  byId('welcome').hidden = Boolean(chat) || editing;
  composer.hidden = !chat || editing || archived;
  renderInputMode();
  byId('archived-conversation').hidden = editing || !archived;
  messages.hidden = editing;
  messages.replaceChildren(...(chat?.turns || []).map(buildMessage));
  messages.scrollTop = messages.scrollHeight;
  renderHistory();
}

function stopSpeech() {
  speechRequest?.abort();
  speechRequest = undefined;
  playback?.();
  playback = undefined;
  avatar.connect();
  stopButton.hidden = true;
  if (previewingVoice) {
    previewingVoice = false;
    previewLabel.textContent = 'Escuchar voz';
    previewStatus.textContent = '';
  }
}

function showSpeechStop() {
  byId('stop-audio-label').textContent = voiceSession ? 'Interrumpir y hablar' : 'Detener voz';
  stopButton.hidden = false;
}

function showMicWave(analyser) {
  const context = micWave.getContext('2d');
  if (!context) return () => {};
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const samples = analyser && new Float32Array(analyser.fftSize);
  const { width, height } = micWave;
  const bars = 17;
  const colors = context.createLinearGradient(0, 0, 0, height);
  colors.addColorStop(0, '#91ecff');
  colors.addColorStop(0.53, '#59bdfe');
  colors.addColorStop(1, '#b183ff');
  let frame;
  let lastDraw = 0;

  function draw(time) {
    const responsive = samples && !motion.matches;
    if (responsive) analyser.getFloatTimeDomainData(samples);
    context.clearRect(0, 0, width, height);
    context.lineWidth = 5;
    context.lineCap = 'round';
    context.strokeStyle = colors;
    context.beginPath();
    for (let bar = 0; bar < bars; bar++) {
      let level = 0;
      if (responsive) {
        const start = Math.floor(bar * samples.length / bars);
        const end = Math.floor((bar + 1) * samples.length / bars);
        for (let sample = start; sample < end; sample++) {
          level += samples[sample] ** 2;
        }
        level = Math.min(1, Math.sqrt(level / (end - start)) * 6);
      }
      const x = (bar + 0.5) * width / bars;
      const shape = 0.57 + 0.43 * Math.sin(bar * 0.5 + time * 0.006);
      const length = responsive ? 3 + level * shape * 42 : 3 + Math.sin(Math.PI * bar / (bars - 1)) * 10;
      context.moveTo(x, (height - length) / 2);
      context.lineTo(x, (height + length) / 2);
    }
    context.stroke();
  }

  function animate(time) {
    if (time - lastDraw >= 32) {
      draw(time);
      lastDraw = time;
    }
    frame = requestAnimationFrame(animate);
  }

  function updateMotion() {
    cancelAnimationFrame(frame);
    draw(performance.now());
    if (analyser && !motion.matches) frame = requestAnimationFrame(animate);
  }

  micWave.hidden = false;
  updateMotion();
  motion.addEventListener('change', updateMotion);
  return () => {
    cancelAnimationFrame(frame);
    motion.removeEventListener('change', updateMotion);
    micWave.hidden = true;
  };
}

function showDictationWave(stream) {
  if (!audioContext) return showMicWave();
  let source;
  try {
    const analyser = audioContext.createAnalyser();
    source = audioContext.createMediaStreamSource(stream);
    source.connect(analyser);
    const hide = showMicWave(analyser);
    return () => {
      hide();
      source.disconnect();
    };
  } catch {
    source?.disconnect();
    return showMicWave();
  }
}

function unlockAudio(force = false, feedback = force ? previewStatus : status) {
  if (!audioEnabled && !force) return;
  try {
    audioContext ??= new AudioContext();
    if (audioContext.state !== 'running') audioContext.resume().catch(() => {});
  } catch {
    feedback.textContent = 'Este navegador no pudo activar el audio.';
  }
}

async function playSpeechStream(response, signal) {
  if (!response.body || !response.headers.get('Content-Type')?.startsWith('application/x-dr-pcm')) {
    throw new Error('La voz llegó en un formato inesperado.');
  }
  if (signal.aborted) return;
  const reader = response.body.getReader();
  const analyser = audioContext.createAnalyser();
  analyser.connect(audioContext.destination);
  avatar.connect(analyser);
  const sources = new Set();
  let position = 0;
  let remainingByte;
  let done = false;

  function finish() {
    analyser.disconnect();
    if (signal.aborted) return;
    playback = undefined;
    speechRequest = undefined;
    avatar.connect();
    stopButton.hidden = true;
  }

  playback = () => {
    void reader.cancel().catch(() => {});
    for (const source of sources) {
      source.onended = null;
      source.stop();
      source.disconnect();
    }
    sources.clear();
    analyser.disconnect();
  };

  while (!signal.aborted) {
    const result = await reader.read();
    if (result.done || signal.aborted) break;
    let bytes = result.value;
    if (remainingByte !== undefined) {
      const joined = new Uint8Array(bytes.length + 1);
      joined[0] = remainingByte;
      joined.set(bytes, 1);
      bytes = joined;
    }
    const count = Math.floor(bytes.length / 2);
    remainingByte = bytes.length % 2 ? bytes[bytes.length - 1] : undefined;
    if (!count) continue;
    const audio = audioContext.createBuffer(1, count, 24000);
    const samples = audio.getChannelData(0);
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    for (let index = 0; index < count; index++) samples[index] = view.getInt16(index * 2, true) / 32768;
    const source = audioContext.createBufferSource();
    source.buffer = audio;
    source.connect(analyser);
    sources.add(source);
    source.onended = () => {
      source.disconnect();
      sources.delete(source);
      if (done && !sources.size) finish();
    };
    const now = audioContext.currentTime;
    if (position <= now) position = now + .12;
    source.start(position);
    position += audio.duration;
  }
  done = true;
  if (!sources.size && !signal.aborted) finish();
}

async function speak(text) {
  if (!audioEnabled || !audioContext) return;
  stopSpeech();
  const controller = new AbortController();
  speechRequest = controller;
  showSpeechStop();
  try {
    const response = await post('speech', {
      text: text.replace(/\[\d+\]/g, '').slice(0, 4096),
      stream: true,
      voice: voicePreference.voice,
      accent: voicePreference.accent
    }, controller.signal);
    await playSpeechStream(response, controller.signal);
  } catch (error) {
    if (controller.signal.aborted) return;
    stopSpeech();
    status.textContent = error.message;
  }
}

function startConversation(byVoice) {
  status.textContent = '';
  chat = { id: crypto.randomUUID(), turns: [] };
  const hello = visitorProfile?.name ? '¡Hola, ' + visitorProfile.name + '!' : '¡Hola!';
  const greeting = hello + greetingContinuation;
  renderChat();
  if (byVoice) {
    void enterVoiceMode(true);
  } else {
    appendTurn({ role: 'assistant', text: greeting, greeting: true });
    setAudioEnabled(false);
    input.focus();
  }
}

byId('start').addEventListener('click', () => startConversation(true));
byId('start-text').addEventListener('click', () => startConversation(false));
switchToVoice.addEventListener('click', () => void enterVoiceMode());
switchToText.addEventListener('click', () => leaveVoiceMode({ focus: true, clearStatus: true }));
muteCall.addEventListener('click', () => {
  if (voiceSession) setCallMuted(voiceSession, !voiceSession.muted);
});
activateCallAudio.addEventListener('click', () => {
  if (!voiceSession) return;
  unlockAudio();
  void playCallAudio(voiceSession);
});

byId('new-chat').addEventListener('click', () => {
  if (busy || processingDictation || recorder) return;
  leaveVoiceMode();
  stopSpeech();
  chat = undefined;
  status.textContent = '';
  input.value = '';
  viewingArchived = false;
  historyStatus.textContent = '';
  renderChat();
  byId('start').focus();
});

historyRecent.addEventListener('click', () => selectHistoryView(false));
historyArchived.addEventListener('click', () => selectHistoryView(true));
byId('restore-conversation').addEventListener('click', () => {
  if (chat?.archived && setArchived(chat, false)) input.focus();
});
deleteConversation.addEventListener('close', () => { conversationToDelete = undefined; });
byId('delete-conversation-form').addEventListener('submit', event => {
  event.preventDefault();
  if (!conversationToDelete || !canManageHistory(deleteStatus)) return;
  const entry = conversationToDelete;
  const next = history.filter(item => item !== entry);
  if (!persist(next, deleteStatus)) return;
  history = next;
  deleteConversation.close();
  if (chat === entry) {
    leaveVoiceMode();
    stopSpeech();
    chat = undefined;
    input.value = '';
    status.textContent = '';
    renderChat();
  } else {
    renderHistory();
  }
  historyStatus.textContent = 'Conversación eliminada.';
  currentHistoryFilter().focus();
});

function setAudioEnabled(enabled) {
  audioEnabled = enabled;
  byId('audio-label').textContent = audioEnabled ? 'Voz activada' : 'Voz desactivada';
  audioToggle.setAttribute('aria-pressed', String(audioEnabled));
  if (!audioEnabled) stopSpeech();
  else unlockAudio();
}

audioToggle.addEventListener('click', () => {
  setAudioEnabled(!audioEnabled);
});

stopButton.addEventListener('click', () => {
  const session = voiceSession;
  if (session) {
    session.interrupted = true;
    session.quietSince = 0;
    liveAudio.muted = true;
    session.call?.interrupt();
    setCallMuted(session, false);
    switchToText.focus({ preventScroll: true });
  } else {
    stopSpeech();
    if (!composer.hidden) input.focus({ preventScroll: true });
  }
});

input.addEventListener('keydown', event => {
  if (event.key !== 'Enter' || event.shiftKey || event.isComposing || event.keyCode === 229) return;
  event.preventDefault();
  if (!send.disabled) composer.requestSubmit(send);
});

composer.addEventListener('submit', event => {
  event.preventDefault();
  const question = input.value.trim();
  if (voiceSession || !question) return;
  void submitQuestion(question);
});

async function submitQuestion(question) {
  if (!chat || chat.archived === true || busy || recorder || processingDictation) return;
  unlockAudio();
  stopSpeech();
  busy = true;
  send.disabled = true;
  dictate.disabled = true;
  renderInputMode();
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
    const answer = await (await post('chat', {
      question,
      history: context,
      profile: visitorProfile?.name ? visitorProfile : undefined,
      accent: voicePreference.accent,
      ...queryOptions()
    })).json();
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
    renderInputMode();
  }
}

function setDictationState(state) {
  const labels = { idle: 'Dictar', requesting: 'Abriendo micrófono…', recording: 'Terminar dictado', transcribing: 'Transcribiendo…' };
  processingDictation = state !== 'idle';
  dictate.dataset.state = state;
  dictate.setAttribute('aria-pressed', String(state === 'recording'));
  dictate.disabled = state === 'requesting' || state === 'transcribing';
  send.disabled = processingDictation;
  renderInputMode();
  byId('dictate-label').textContent = labels[state];
  if (state === 'recording') {
    delete dictationPreview.dataset.hasText;
    dictationText.textContent = 'El texto aparecerá aquí mientras hablas.';
    dictationPreview.hidden = false;
  } else if (state === 'idle') {
    dictationPreview.hidden = true;
  }
}

function createDictationRecorder(stream) {
  const Recorder = window.MediaRecorder;
  const formats = ['audio/mp4', 'audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  for (const mimeType of formats) {
    if (!Recorder.isTypeSupported?.(mimeType)) continue;
    try { return new Recorder(stream, { mimeType, audioBitsPerSecond: 96_000 }); } catch {}
  }
  return new Recorder(stream);
}

function wavBlob(parts, sampleRate) {
  const size = parts.reduce((total, part) => total + part.byteLength, 0);
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const bytes = new Uint8Array(header);
  const encoder = new TextEncoder();
  bytes.set(encoder.encode('RIFF'), 0);
  view.setUint32(4, 36 + size, true);
  bytes.set(encoder.encode('WAVEfmt '), 8);
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  bytes.set(encoder.encode('data'), 36);
  view.setUint32(40, size, true);
  return new Blob([header, ...parts], { type: 'audio/wav' });
}

function showDictationPreviewError() {
  const message = 'La vista previa no está disponible. El texto se transcribirá al terminar el dictado.';
  if (dictationPreview.dataset.hasText) status.textContent = message;
  else dictationText.textContent = message;
}

async function startDictationPreview(stream, isReleased) {
  const context = audioContext;
  if (!context?.audioWorklet) throw new Error('AudioWorklet no disponible');
  await context.audioWorklet.addModule('/dictation-worklet.js');
  if (isReleased()) return;
  if (context.state !== 'running') await context.resume();
  if (isReleased()) return;
  const node = new AudioWorkletNode(context, 'dictation-samples');
  const source = context.createMediaStreamSource(stream);
  const controller = new AbortController();
  const queue = [];
  let sending = false;

  function cleanup() {
    if (controller.signal.aborted) return;
    controller.abort();
    node.port.onmessage = null;
    node.port.close();
    source.disconnect();
    node.disconnect();
  }

  async function updatePreview() {
    if (sending) return;
    sending = true;
    try {
      while (queue.length && !isReleased()) {
        const audio = wavBlob(queue.splice(0, 4), context.sampleRate);
        const result = await api('transcribe?format=wav', {
          method: 'POST', body: audio, signal: controller.signal
        });
        const { text } = await result.json();
        if (isReleased()) return;
        const segment = (text || '').trim();
        if (!segment) continue;
        const previous = dictationPreview.dataset.hasText ? dictationText.textContent + ' ' : '';
        dictationText.textContent = previous + segment;
        dictationPreview.dataset.hasText = 'true';
        dictationText.scrollTop = dictationText.scrollHeight;
      }
    } catch {
      cleanup();
      if (!isReleased()) showDictationPreviewError();
    } finally {
      sending = false;
    }
  }

  node.port.onmessage = ({ data }) => {
    if (isReleased() || controller.signal.aborted) return;
    queue.push(data);
    void updatePreview();
  };
  source.connect(node);
  // The processor leaves its output silent while the destination keeps it active.
  node.connect(context.destination);
  return cleanup;
}

function audioExtension(mime) {
  const container = mime.split(';')[0].trim().toLowerCase().split('/').at(-1);
  if (container === 'x-m4a') return 'm4a';
  return ['mp4', 'm4a', 'webm', 'ogg', 'wav'].includes(container) ? container : undefined;
}

async function transcribeRecording(chunks, mime, audioLimit, signal) {
  if (!chunks.length) throw new Error('No se grabó audio. Intenta hablar unos segundos.');
  const format = audioExtension(mime);
  if (!format) throw new Error('El navegador grabó en un formato de audio no compatible.');
  const audio = new Blob(chunks, { type: mime });
  if (audio.size > audioLimit) throw new Error('La grabación supera el límite de carga. Prueba con una consulta más corta.');
  const result = await api('transcribe?format=' + format, { method: 'POST', body: audio, signal });
  const { text } = await result.json();
  if (!text?.trim()) throw new Error('No se detectó lo que dijiste.');
  return text.trim();
}

function renderInputMode() {
  const active = Boolean(voiceSession);
  input.hidden = active;
  byId('text-actions').hidden = active;
  byId('voice-actions').hidden = !active;
  audioToggle.hidden = active;
  switchToVoice.disabled = busy || processingDictation;
  muteCall.disabled = voiceSession?.state !== 'connected';
  muteCall.setAttribute('aria-pressed', String(Boolean(voiceSession?.muted)));
  muteCall.textContent = voiceSession?.muted ? 'Activar micrófono' : 'Silenciar micrófono';
  activateCallAudio.hidden = !voiceSession?.playBlocked;
}

function showCallStatus(session) {
  if (voiceSession !== session) return;
  stopButton.hidden = !(session.lookingUp || session.speaking) || session.interrupted;
  byId('stop-audio-label').textContent = 'Interrumpir y hablar';
  const labels = {
    connecting: 'Conectando la llamada…',
    reconnecting: 'Recuperando la conexión…'
  };
  const text = labels[session.state] || (session.playBlocked ? 'Activa el audio para oír al Dr.'
    : session.lookingUp ? 'Consultando la biblioteca…'
    : session.muted ? 'Micrófono silenciado.'
    : 'Te escucho…');
  if (status.textContent !== text) status.textContent = text;
}

function updateCallWave(session) {
  if (voiceSession !== session) return;
  const reading = session.state === 'connected' && !session.muted && session.micAnalyser;
  if (reading && !session.hideWave) {
    session.hideWave = showMicWave(session.micAnalyser);
  } else if (!reading && session.hideWave) {
    session.hideWave();
    session.hideWave = undefined;
  }
}

function setCallMuted(session, muted) {
  session.muted = muted;
  session.call?.mute(muted);
  renderInputMode();
  updateCallWave(session);
  showCallStatus(session);
}

function leaveVoiceMode({ focus = false, clearStatus = false, graceful = true } = {}) {
  if (!voiceSession) return;
  const session = voiceSession;
  voiceSession = undefined;
  clearTimeout(session.saveTimer);
  clearInterval(session.speakerMonitor);
  session.hideWave?.();
  session.micSource?.disconnect();
  session.remoteSource?.disconnect();
  session.call?.close(graceful);
  liveAudio.pause();
  liveAudio.srcObject = null;
  liveAudio.muted = false;
  if (history.includes(session.chat)) persist();
  if (chat === session.chat) renderHistory();
  setAudioEnabled(false);
  renderInputMode();
  if (clearStatus && !busy) status.textContent = '';
  if (focus) input.focus();
}

function voiceError(session, error) {
  if (voiceSession !== session) return;
  leaveVoiceMode({ focus: true, graceful: false });
  status.textContent = error.name === 'NotAllowedError' ? 'Permite el uso del micrófono para conversar.'
    : error.name === 'NotFoundError' ? 'No se detectó ningún micrófono.'
    : error.message;
}

function playCallAudio(session) {
  return liveAudio.play().then(() => {
    if (voiceSession !== session) return;
    session.playBlocked = false;
    renderInputMode();
    showCallStatus(session);
  }).catch(() => {
    if (voiceSession !== session) return;
    session.playBlocked = true;
    renderInputMode();
    showCallStatus(session);
  });
}

function connectCallMicrophone(session, stream) {
  session.hideWave?.();
  session.hideWave = undefined;
  session.micSource?.disconnect();
  session.micSource = audioContext.createMediaStreamSource(stream);
  session.micAnalyser = audioContext.createAnalyser();
  session.micSource.connect(session.micAnalyser);
  updateCallWave(session);
}

function connectCallOutput(session, stream) {
  liveAudio.srcObject = stream;
  void playCallAudio(session);
  clearInterval(session.speakerMonitor);
  session.remoteSource?.disconnect();
  const analyser = audioContext.createAnalyser();
  session.remoteSource = audioContext.createMediaStreamSource(stream);
  session.remoteSource.connect(analyser);
  const samples = new Float32Array(analyser.fftSize);
  session.speakerMonitor = setInterval(() => {
    analyser.getFloatTimeDomainData(samples);
    const energy = samples.reduce((sum, value) => sum + value * value, 0) / samples.length;
    const now = performance.now();
    if (energy > 0.00008) session.quietSince = 0;
    else session.quietSince ||= now;
    if (session.interrupted && session.quietSince && now - session.quietSince > 380) {
      session.interrupted = false;
      liveAudio.muted = false;
    }
    const speaking = !session.interrupted && !session.playBlocked &&
      (!session.quietSince || (session.speaking && now - session.quietSince < 200));
    if (session.speaking !== speaking) {
      session.speaking = speaking;
      avatar.connect(speaking ? analyser : undefined);
    }
    showCallStatus(session);
  }, 60);
}

function showLiveTranscript(session, turn, ordered) {
  if (voiceSession !== session) return;
  let node = session.nodes.get(turn);
  if (!node) {
    const later = ordered.slice(ordered.indexOf(turn) + 1).find(item => session.nodes.has(item));
    const position = later ? chat.turns.indexOf(later) : chat.turns.length;
    chat.turns.splice(position, 0, turn);
    rememberConversation(turn);
    node = buildMessage(turn);
    session.nodes.set(turn, node);
    messages.insertBefore(node, later ? session.nodes.get(later) : null);
  } else {
    node.querySelector('p').textContent = plainMessage(turn.text);
  }
  messages.scrollTop = messages.scrollHeight;
  if (!session.saveTimer) {
    session.saveTimer = setTimeout(() => {
      session.saveTimer = undefined;
      if (history.includes(chat)) persist();
      renderHistory();
    }, 300);
  }
}

function queryOptions() {
  return { mode: byId('query-mode').value, asOf: byId('query-date').value };
}

async function enterVoiceMode(greet = false) {
  if (voiceSession || !chat || chat.archived || busy || processingDictation) return;
  const session = { state: 'connecting', chat, muted: false, nodes: new WeakMap() };
  voiceSession = session;
  setAudioEnabled(true);
  stopSpeech();
  renderInputMode();
  showCallStatus(session);
  switchToText.focus({ preventScroll: true });
  try {
    if (!navigator.mediaDevices?.getUserMedia || !window.RTCPeerConnection || !audioContext) {
      throw new Error('La conversación por voz requiere un navegador compatible y HTTPS o localhost.');
    }
    const config = await getConfig();
    if (voiceSession !== session) return;
    if (!config.configured) throw new Error(config.adminRequired
      ? 'La conversación con IA para visitantes todavía no está habilitada.' : keyRequired);
    const voice = voicePreference.voice || config.voice;
    const accent = voicePreference.accent || config.accent;
    session.call = createLiveCall({
      negotiate: async (sdp, signal) => (await post('live-session', {
        sdp, voice, accent, greet,
        history: session.chat.turns.filter(turn => !turn.greeting && !turn.pending).slice(-24),
        profile: visitorProfile?.name ? visitorProfile : undefined
      }, signal)).json(),
      lookup: async (turn, signal) => (await post('live-lookup', {
        question: turn.text,
        history: session.chat.turns.slice(0, session.chat.turns.indexOf(turn))
          .filter(item => !item.greeting && !item.pending).slice(-20),
        profile: visitorProfile?.name ? visitorProfile : undefined,
        accent,
        ...queryOptions()
      }, signal)).json(),
      onTranscript: (turn, ordered) => showLiveTranscript(session, turn, ordered),
      onMicrophone: stream => connectCallMicrophone(session, stream),
      onRemote: stream => connectCallOutput(session, stream),
      onState(state) {
        session.state = state;
        renderInputMode();
        updateCallWave(session);
        showCallStatus(session);
        if (state === 'connected') syncCallContext();
      },
      onLookup(active) {
        session.lookingUp = active;
        showCallStatus(session);
      },
      onEvidence(result) {
        if (voiceSession === session) appendTurn({ role: 'assistant', libraryResult: true, ...result });
      },
      onError: error => voiceError(session, error)
    });
    await session.call.connect();
  } catch (error) {
    voiceError(session, error);
  }
}

function syncCallContext() {
  const session = voiceSession;
  if (session?.state !== 'connected') return;
  const { mode, asOf } = queryOptions();
  const modeLabel = mode === 'audiencia' ? 'Audiencia o exposición' : 'Consulta jurídica';
  const context = 'Modo elegido: ' + modeLabel + '. Fecha de referencia: ' + (asOf || 'ninguna') + '.';
  if (session.context !== context) {
    session.context = context;
    session.call.updateContext(context);
  }
}

byId('query-mode').addEventListener('change', syncCallContext);
byId('query-date').addEventListener('change', syncCallContext);
window.addEventListener('pagehide', () => leaveVoiceMode({ graceful: false }));

dictate.addEventListener('click', async () => {
  if (recorder?.state === 'recording') {
    dictate.disabled = true;
    recorder.stop();
    return;
  }
  if (voiceSession || busy || processingDictation) return;
  stopSpeech();
  unlockAudio(true, status);
  setDictationState('requesting');
  status.textContent = 'Esperando acceso al micrófono…';
  let stream;
  let limit;
  let stopPreview;
  let hideWave;
  let released = false;
  function releaseCapture() {
    if (released) return;
    released = true;
    clearTimeout(limit);
    stopPreview?.();
    hideWave?.();
    stream?.getTracks().forEach(track => track.stop());
  }
  function reset() {
    releaseCapture();
    recorder = undefined;
    setDictationState('idle');
  }
  try {
    const config = await getConfig();
    if (!config.configured) throw new Error(config.adminRequired
      ? 'Entra en Configuración y guarda tu clave de OpenAI para usar el dictado.' : keyRequired);
    if (!navigator.mediaDevices?.getUserMedia || !window.MediaRecorder) {
      throw new Error('El dictado requiere un navegador compatible y una conexión HTTPS o localhost.');
    }
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    const capture = createDictationRecorder(stream);
    recorder = capture;
    const chunks = [];
    const finishRecording = () => {
      if (capture.state === 'recording') {
        dictate.disabled = true;
        capture.stop();
      }
    };
    capture.ondataavailable = event => { if (event.data.size) chunks.push(event.data); };
    capture.onerror = () => {
      capture.onstop = null;
      reset();
      status.textContent = 'No se pudo grabar el audio. Revisa el micrófono e intenta de nuevo.';
    };
    capture.onstop = async () => {
      releaseCapture();
      setDictationState('transcribing');
      status.textContent = 'Transcribiendo…';
      try {
        const mime = chunks.find(chunk => chunk.type)?.type || capture.mimeType || '';
        const transcript = await transcribeRecording(chunks, mime, config.audioLimit);
        input.value = [input.value.trim(), transcript].filter(Boolean).join(' ').slice(0, input.maxLength);
        status.textContent = 'Dictado listo para revisar y enviar.';
        input.focus();
      } catch (error) {
        if (dictationPreview.dataset.hasText) {
          input.value = [input.value.trim(), dictationText.textContent].filter(Boolean).join(' ').slice(0, input.maxLength);
          status.textContent = 'Se conservó el texto provisional. Revísalo: puede faltar parte del dictado.';
          input.focus();
        } else {
          status.textContent = error.message;
        }
      } finally {
        reset();
      }
    };
    capture.start();
    limit = setTimeout(finishRecording, 120_000);
    setDictationState('recording');
    status.textContent = 'Habla y pulsa Terminar dictado cuando hayas terminado.';
    hideWave = showDictationWave(stream);
    void startDictationPreview(stream, () => released).then(cleanup => {
      if (released) cleanup?.();
      else stopPreview = cleanup;
    }).catch(() => {
      if (!released) showDictationPreviewError();
    });
  } catch (error) {
    reset();
    status.textContent = error.name === 'NotAllowedError' ? 'Permite el uso del micrófono para dictar.'
      : error.name === 'NotFoundError' ? 'No se detectó ningún micrófono.'
      : error.message;
  }
});

const settingsForm = byId('settings-form');
const configStatus = byId('settings-status');
const saveConfig = settingsForm.querySelector('[type="submit"]');
const adminForm = byId('admin-form');
const adminPassword = byId('admin-password');
const settingsAccess = byId('settings-access-status');
const settingsNav = byId('settings-nav');
let settingsSection = 'preferences';

function showConfig(config) {
  byId('api-key').value = '';
  byId('key-note').textContent = config.hosted
    ? (config.configured ? 'Ya hay una clave cifrada para este navegador. Deja el campo vacío para conservarla.'
      : 'La app guarda la clave cifrada para este navegador.')
    : (config.configured ? 'Ya hay una clave guardada. Deja el campo vacío para conservarla.'
      : 'La clave se guarda en el servidor local.');
  for (const field of ['voice', 'accent']) {
    const select = byId(field);
    const preference = config.hosted && voicePreference[field];
    select.value = Array.from(select.options).some(option => option.value === preference)
      ? preference : config[field];
  }
  renderVoicePreview();
}

async function loadSettingsAccess() {
  settingsAccess.textContent = 'Comprobando acceso…';
  configRequest = undefined;
  try {
    const config = await getConfig();
    settingsAccess.textContent = '';
    adminForm.hidden = !config.adminRequired;
    settingsNav.hidden = Boolean(config.adminRequired);
    if (config.adminRequired) {
      adminPassword.focus();
      return;
    }
    showConfig(config);
    saveConfig.disabled = false;
    showSettingsSection(settingsSection === 'library');
    if (settingsSection === 'library') startIndexRefresh();
  } catch (error) {
    settingsAccess.textContent = error.message;
  }
}

function openSettings(section) {
  leaveVoiceMode();
  settingsSection = section;
  if (previewingVoice) stopSpeech();
  library.hidden = true;
  settingsForm.hidden = true;
  settingsNav.hidden = true;
  adminForm.hidden = true;
  configStatus.textContent = '';
  saveConfig.disabled = true;
  previewVoice.disabled = true;
  byId('settings').showModal();
  void loadSettingsAccess();
}

byId('open-settings').addEventListener('click', () => openSettings('preferences'));
byId('library-shortcut').addEventListener('click', () => openSettings('library'));

adminForm.addEventListener('submit', async event => {
  event.preventDefault();
  const submit = adminForm.querySelector('[type="submit"]');
  submit.disabled = true;
  settingsAccess.textContent = 'Verificando credenciales…';
  try {
    await post('admin-login', { password: adminPassword.value });
    adminPassword.value = '';
    await loadSettingsAccess();
  } catch (error) {
    settingsAccess.textContent = error.message;
    adminPassword.focus();
  } finally {
    submit.disabled = false;
  }
});

const voiceSamples = new Map();

function selectedVoiceSample() {
  return byId('voice').value + '-' + byId('accent').value;
}

function voiceSampleUrl(name) {
  return '/voice-previews/v1/' + name + '.mp3';
}

function renderVoicePreview() {
  if (previewingVoice) return;
  const sample = voiceSamples.get(selectedVoiceSample());
  previewVoice.disabled = !sample?.url;
  previewStatus.textContent = sample?.failed ? 'Esta muestra aún no está disponible.'
    : sample && !sample.url ? 'Descargando la muestra…' : '';
}

function preloadVoiceSample(name) {
  if (voiceSamples.has(name) && !voiceSamples.get(name).failed) return;
  const sample = {};
  voiceSamples.set(name, sample);
  void fetch(voiceSampleUrl(name))
    .then(response => {
      if (!response.ok || !response.headers.get('Content-Type')?.startsWith('audio/')) {
        throw new Error('Muestra no disponible');
      }
      return response.blob();
    })
    .then(blob => {
      sample.url = URL.createObjectURL(blob);
    })
    .catch(() => {
      sample.failed = true;
    })
    .finally(() => {
      if (name === selectedVoiceSample()) renderVoicePreview();
    });
}

function preloadVoiceSamples() {
  for (const voice of byId('voice').options) {
    for (const accent of byId('accent').options) preloadVoiceSample(voice.value + '-' + accent.value);
  }
  renderVoicePreview();
}

for (const field of ['voice', 'accent']) {
  byId(field).addEventListener('change', () => {
    if (previewingVoice) stopSpeech();
    renderVoicePreview();
  });
}

previewVoice.addEventListener('click', () => {
  if (previewingVoice) {
    stopSpeech();
    return;
  }
  const sample = voiceSamples.get(selectedVoiceSample());
  if (!sample?.url) return;
  stopSpeech();
  const audio = new Audio(sample.url);
  previewingVoice = true;
  previewLabel.textContent = 'Detener muestra';
  previewStatus.textContent = 'Reproduciendo muestra…';
  const stop = () => {
    audio.onended = null;
    audio.pause();
  };
  playback = stop;
  audio.onended = () => {
    if (playback === stop) stopSpeech();
  };
  void audio.play().catch(() => {
    if (playback !== stop) return;
    stopSpeech();
    previewStatus.textContent = 'No se pudo reproducir la muestra.';
  });
});

settingsForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (previewingVoice) stopSpeech();
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
const uploadStatus = byId('upload-status');
const library = byId('library');
const dropZone = byId('drop-zone');
const selector = byId('document');
const choosePdf = byId('choose-pdf');
const submitDocuments = byId('submit-documents');
const validityForm = byId('validity-form');
const validityStatus = byId('validity-status');
const validityLabels = { sin_revisar: 'Sin revisar', vigente: 'Vigente', historica: 'Versión histórica', derogada: 'Derogada' };
const settingsDialog = byId('settings');
let editingDocument;
let selectedFiles = [];
const submittedDocuments = new Map();
let indexingTimer;
let indexDeadline;
let uploading = false;
let refreshing = false;
let renderedDocuments;

function showSettingsSection(showLibrary) {
  library.hidden = !showLibrary;
  settingsForm.hidden = showLibrary;
  byId('open-preferences').setAttribute('aria-pressed', String(!showLibrary));
  byId('open-library').setAttribute('aria-pressed', String(showLibrary));
  if (!showLibrary) {
    clearTimeout(indexingTimer);
    validityForm.hidden = true;
  }
  if (showLibrary && previewingVoice) stopSpeech();
  if (!showLibrary) preloadVoiceSamples();
}

function renderDocuments(files) {
  const snapshot = JSON.stringify(files);
  if (snapshot === renderedDocuments) return;
  renderedDocuments = snapshot;
  const labels = { completed: 'Listo para consultar', in_progress: 'Preparando', failed: 'No se pudo preparar', cancelled: 'Preparación cancelada' };
  byId('documents').replaceChildren(...files.map(file => {
    const row = document.createElement('li');
    const name = document.createElement('strong');
    name.textContent = file.name;
    const state = document.createElement('span');
    state.className = 'index-state';
    state.dataset.status = file.status;
    state.textContent = labels[file.status] || 'Estado pendiente';
    row.append(name, state);
    if (file.id && file.status === 'completed') {
      const actions = document.createElement('div');
      actions.className = 'validity-row';
      const metadata = document.createElement('span');
      const { state, version, from, until } = file.validity || {};
      const range = from && until ? from + ' a ' + until
        : from ? 'Desde ' + from : until ? 'Hasta ' + until : '';
      metadata.textContent = [validityLabels[state] || 'Sin revisar', version, range]
        .filter(Boolean).join(' · ');
      const edit = button('Editar vigencia', () => editValidity(file));
      edit.setAttribute('aria-label', 'Editar vigencia de ' + file.name);
      actions.append(metadata, edit);
      row.append(actions);
    } else if (['failed', 'cancelled'].includes(file.status)) {
      const help = document.createElement('p');
      help.className = 'muted';
      help.textContent = 'Puedes volver a subir el documento. Si es un PDF escaneado, usa una copia con texto seleccionable.';
      row.append(help);
    }
    return row;
  }));
}

function editValidity(file) {
  editingDocument = file;
  validityForm.hidden = false;
  validityStatus.textContent = '';
  byId('validity-heading').textContent = 'Vigencia de ' + file.name;
  for (const field of ['state', 'version', 'from', 'until']) {
    byId('validity-' + field).value = file.validity?.[field] || (field === 'state' ? 'sin_revisar' : '');
  }
  byId('validity-state').focus();
}

byId('close-validity').addEventListener('click', () => {
  validityForm.hidden = true;
  editingDocument = undefined;
  refreshButton.focus();
});

validityForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (!editingDocument) return;
  const submit = event.submitter;
  const data = { id: editingDocument.id };
  for (const field of ['state', 'version', 'from', 'until']) data[field] = byId('validity-' + field).value;
  submit.disabled = true;
  validityStatus.textContent = 'Guardando vigencia…';
  try {
    await post('document-validity', data);
    if (editingDocument?.id === data.id) {
      validityForm.hidden = true;
      editingDocument = undefined;
      refreshButton.focus();
    }
    await refreshLibrary();
  } catch (error) {
    validityStatus.textContent = error.message;
  } finally {
    submit.disabled = false;
  }
});

function scheduleIndexRefresh() {
  clearTimeout(indexingTimer);
  if (settingsDialog.open && !library.hidden && Date.now() < indexDeadline) {
    indexingTimer = setTimeout(() => void refreshLibrary({ quiet: true }), 4000);
  }
}

async function refreshLibrary({ quiet = false } = {}) {
  if (refreshing || uploading || !settingsDialog.open || library.hidden) return;
  clearTimeout(indexingTimer);
  refreshing = true;
  refreshButton.disabled = true;
  updateUploadButton();
  if (!quiet) libraryStatus.textContent = 'Cargando biblioteca…';
  try {
    const config = await getConfig();
    uploadForm.hidden = !config.libraryConfigured || !config.configured;
    if (uploadForm.hidden) {
      renderDocuments([]);
      libraryStatus.textContent = !config.configured
        ? 'Guarda la clave de OpenAI en Preferencias para abrir la biblioteca.'
        : 'La biblioteca todavía necesita un índice configurado en Vercel.';
      return;
    }
    byId('document-note').textContent = 'Puedes elegir varios archivos o arrastrarlos aquí. PDF, Word (.docx), TXT o Markdown, hasta '
      + config.documentLimit / (1024 * 1024) + ' MB por archivo. Los documentos se preparan para la búsqueda.';
    const files = await (await api('documents')).json();
    for (const file of files) submittedDocuments.delete(file.id);
    const visibleFiles = [...submittedDocuments.values(), ...files];
    renderDocuments(visibleFiles);
    const indexing = submittedDocuments.size > 0 || files.some(file => file.status === 'in_progress');
    if (indexing) scheduleIndexRefresh();
    const ready = visibleFiles.filter(file => file.status === 'completed').length;
    const readyMessage = ready === 1 ? 'El Dr. ya puede consultar 1 documento.'
      : ready ? `El Dr. ya puede consultar ${ready} documentos.` : '';
    const pendingMessage = indexing ? (Date.now() < indexDeadline
      ? 'Los archivos en preparación se actualizan automáticamente.'
      : 'Hay archivos en preparación. Pulsa Actualizar para comprobar su estado.') : '';
    const message = visibleFiles.length
      ? [readyMessage, pendingMessage].filter(Boolean).join(' ') || 'Aún no hay documentos listos para consultar.'
      : 'Agrega tu primer documento para que el Dr. pueda usarlo en sus respuestas.';
    if (libraryStatus.textContent !== message) libraryStatus.textContent = message;
  } catch (error) {
    libraryStatus.textContent = error.message;
    if (quiet) scheduleIndexRefresh();
  } finally {
    refreshing = false;
    refreshButton.disabled = false;
    updateUploadButton();
  }
}

function startIndexRefresh() {
  indexDeadline = Date.now() + 120_000;
  void refreshLibrary();
}

byId('open-preferences').addEventListener('click', () => showSettingsSection(false));
byId('open-library').addEventListener('click', () => {
  showSettingsSection(true);
  startIndexRefresh();
});
refreshButton.addEventListener('click', startIndexRefresh);
settingsDialog.addEventListener('close', () => {
  clearTimeout(indexingTimer);
  validityForm.hidden = true;
  editingDocument = undefined;
  adminPassword.value = '';
  if (previewingVoice) stopSpeech();
});

function renderSelection() {
  byId('selected-documents').replaceChildren(...selectedFiles.map(file => {
    const row = document.createElement('li');
    const name = document.createElement('span');
    iconLabel(name, '▤', file.name);
    const remove = button('×', () => {
      selectedFiles = selectedFiles.filter(selected => selected !== file);
      renderSelection();
      choosePdf.focus();
    });
    remove.setAttribute('aria-label', 'Quitar ' + file.name);
    remove.disabled = uploading;
    row.append(name, remove);
    return row;
  }));
  choosePdf.disabled = uploading;
  updateUploadButton();
}

function updateUploadButton() {
  const count = selectedFiles.length;
  submitDocuments.hidden = !count;
  submitDocuments.disabled = uploading || refreshing || !count;
  submitDocuments.textContent = uploading ? 'Subiendo archivos…'
    : count === 1 ? 'Subir 1 archivo' : `Subir ${count} archivos`;
}

async function addSelection(files) {
  if (uploading) return;
  try {
    const { documentLimit } = await getConfig();
    if (uploading) return;
    const rejected = [];
    for (const file of files) {
      if (!/^[^/\\]{1,200}\.(pdf|docx|txt|md)$/i.test(file.name)) {
        rejected.push(file.name + ' (usa PDF, DOCX, TXT o Markdown y un nombre de hasta 200 caracteres antes de la extensión)');
      } else if (!file.size || file.size > documentLimit) {
        rejected.push(file.name + (file.size ? ' (supera el tamaño permitido)' : ' (está vacío)'));
      } else if (!selectedFiles.some(selected => selected.name === file.name
        && selected.size === file.size && selected.lastModified === file.lastModified)) {
        selectedFiles.push(file);
      }
    }
    renderSelection();
    uploadStatus.textContent = rejected.length
      ? 'Revisa estos archivos antes de subirlos. ' + rejected.join('. ')
      : '';
  } catch (error) {
    uploadStatus.textContent = error.message;
  }
}

choosePdf.addEventListener('click', () => selector.click());
selector.addEventListener('change', () => {
  void addSelection(Array.from(selector.files));
  selector.value = '';
});
dropZone.addEventListener('dragover', event => {
  if (!event.dataTransfer.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = uploading ? 'none' : 'copy';
  dropZone.classList.toggle('dragging', !uploading);
});
dropZone.addEventListener('dragleave', event => {
  if (!dropZone.contains(event.relatedTarget)) dropZone.classList.remove('dragging');
});
dropZone.addEventListener('drop', event => {
  event.preventDefault();
  dropZone.classList.remove('dragging');
  void addSelection(Array.from(event.dataTransfer.files));
});

const pendingIndex = new WeakMap();
const documentTypes = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  txt: 'text/plain',
  md: 'text/markdown'
};

async function uploadLibraryFile(file) {
  const { directDocumentUpload } = await getConfig();
  if (!directDocumentUpload) {
    return api('documents?name=' + encodeURIComponent(file.name), { method: 'POST', body: file });
  }

  let id = pendingIndex.get(file);
  if (!id) {
    const signed = await (await post('document-upload', { name: file.name })).json();
    const type = documentTypes[file.name.split('.').pop().toLowerCase()];
    const body = new FormData();
    body.append('cacheControl', '0');
    body.append('', new Blob([file], { type }), file.name);
    const uploaded = await fetch(signed.uploadUrl, { method: 'PUT', body });
    if (!uploaded.ok) throw new Error('No se pudo guardar el archivo en la biblioteca.');
    id = signed.id;
    pendingIndex.set(file, id);
  }
  uploadStatus.textContent = 'Preparando el texto de ' + file.name + ' para que el Dr. pueda consultarlo.';
  return post('document-index', { id });
}

uploadForm.addEventListener('submit', async event => {
  event.preventDefault();
  if (uploading || refreshing || !selectedFiles.length) return;
  clearTimeout(indexingTimer);
  uploading = true;
  renderSelection();
  refreshButton.disabled = true;
  const errors = [];
  const queue = selectedFiles.slice();
  for (const [position, file] of queue.entries()) {
    uploadStatus.textContent = `Subiendo archivo ${position + 1} de ${queue.length}. ${file.name}`;
    try {
      const response = await uploadLibraryFile(file);
      const indexed = await response.json();
      submittedDocuments.set(indexed.id, { ...indexed, status: indexed.status || 'in_progress' });
      selectedFiles = selectedFiles.filter(selected => selected !== file);
    } catch (error) {
      errors.push(file.name + ' (' + error.message + ')');
    }
  }
  uploading = false;
  renderSelection();
  refreshButton.disabled = false;
  indexDeadline = Date.now() + 120_000;
  uploadStatus.textContent = errors.length
    ? 'Quedaron archivos pendientes de envío. ' + errors.join(' ')
    : 'Archivos enviados. Revisa su estado abajo.';
  await refreshLibrary();
});

byId('share-form').addEventListener('submit', event => {
  event.preventDefault();
  const phoneInput = byId('phone');
  const phone = phoneInput.value.replace(/[\s()+-]/g, '');
  if (!/^[1-9]\d{7,14}$/.test(phone)) {
    byId('share-note').textContent = 'Ingresa un número válido con código de país.';
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
if (!visitorProfile) openProfile(true);
void getConfig().catch(() => {});
