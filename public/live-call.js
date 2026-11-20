function waitForIce(peer, signal) {
  if (peer.iceGatheringState === 'complete' || signal.aborted) return Promise.resolve();
  return new Promise(resolve => {
    const timeout = setTimeout(finish, 4500);
    function finish() {
      clearTimeout(timeout);
      signal.removeEventListener('abort', finish);
      peer.removeEventListener('icegatheringstatechange', changed);
      resolve();
    }
    function changed() {
      if (peer.iceGatheringState === 'complete') finish();
    }
    signal.addEventListener('abort', finish, { once: true });
    peer.addEventListener('icegatheringstatechange', changed);
  });
}

export function createLiveCall(callbacks) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const groups = [];
  const received = new Set();
  const delegationIds = new Set();
  const questions = new WeakMap();
  const acks = new Map();
  let peer, channel, track, sender, task;
  let setupTimeout, recoveryTimeout, closingTimeout;
  let ready = false;
  let muted = false;
  let replacing = false;
  let disposed = false;

  function send(type, fields = {}) {
    if (channel?.readyState !== 'open') return false;
    const event = { type, event_id: crypto.randomUUID(), ...fields };
    channel.send(JSON.stringify(event));
    return event.event_id;
  }

  function cancelLookup() {
    if (!task) return;
    clearTimeout(task.timer);
    task.controller.abort();
    task = undefined;
    callbacks.onLookup(false);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    clearTimeout(closingTimeout);
    channel?.close();
    peer?.close();
  }

  function close(graceful = true) {
    if (signal.aborted) {
      if (!graceful) dispose();
      return;
    }
    lifetime.abort();
    cancelLookup();
    clearTimeout(setupTimeout);
    clearTimeout(recoveryTimeout);
    track?.stop();
    if (graceful && ready && send('session.close')) closingTimeout = setTimeout(dispose, 3000);
    else dispose();
  }

  function fail(error) {
    if (signal.aborted) return;
    close(false);
    callbacks.onError(error);
  }

  function connectMicrophone() {
    return navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }
    });
  }

  function useMicrophone(stream) {
    track = stream.getAudioTracks()[0];
    if (!track) throw new Error('No se detectó ningún micrófono.');
    track.enabled = !muted;
    track.addEventListener('ended', replaceMicrophone, { once: true });
    callbacks.onMicrophone(stream);
  }

  async function replaceMicrophone() {
    if (signal.aborted || !sender || replacing) return;
    replacing = true;
    let stream;
    try {
      stream = await connectMicrophone();
      if (signal.aborted) return;
      const replacement = stream.getAudioTracks()[0];
      if (!replacement) throw new Error('No se detectó ningún micrófono.');
      replacement.enabled = !muted;
      await sender.replaceTrack(replacement);
      if (!signal.aborted) useMicrophone(stream);
    } catch (error) {
      stream?.getTracks().forEach(item => item.stop());
      fail(error);
    } finally {
      if (signal.aborted) stream?.getTracks().forEach(item => item.stop());
      replacing = false;
    }
  }

  function transcript(event, role) {
    const { start_ms: start, end_ms: end, delta } = event;
    if (typeof delta !== 'string' || !Number.isFinite(start) || !Number.isFinite(end)) return;
    const gap = 950;
    let group = groups.findLast(item => item.turn.role === role &&
      start <= item.end + gap && end >= item.start - gap &&
      !groups.some(other => other.turn.role !== role && other.start > Math.min(item.end, end) &&
        other.end < Math.max(item.start, start)));
    if (!group) {
      group = { start, end, parts: [], turn: { role, text: '' } };
      groups.push(group);
    }
    group.start = Math.min(start, group.start);
    group.end = Math.max(end, group.end);
    group.parts.push({ start, delta });
    group.parts.sort((a, b) => a.start - b.start);
    group.turn.text = group.parts.map(part => part.delta).join('').slice(0, 8000);
    if (group.turn.text.trim()) callbacks.onTranscript(group.turn, groups
      .filter(item => item.turn.text.trim()).sort((a, b) => a.start - b.start).map(item => item.turn));
    const correction = /^(?:espera|corrijo|me refería|más bien|en realidad)\b/i.test(delta.trim());
    if (role === 'user' && task && start > task.offset + 180 &&
        (correction || (task.group ? task.group !== group : start > task.offset + 950)) &&
        !/^(?:ajá|mhm|mm+)[.!?\s]*$/i.test(delta.trim()) && group.turn.text.trim()) cancelLookup();
  }

  function appendContext(content, id, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(signal.reason);
      const eventId = send('session.thinking.append', { delegation_id: id, content });
      if (!eventId) return reject(new Error('Se perdió la conexión de voz.'));
      const timer = setTimeout(() => settle(new Error('La sesión no confirmó las fuentes.')), 8000);
      const abort = () => settle(signal.reason);
      function settle(error) {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
        acks.delete(eventId);
        if (error) reject(error);
        else resolve();
      }
      acks.set(eventId, settle);
      signal.addEventListener('abort', abort, { once: true });
    });
  }

  async function lookup(current) {
    const signal = current.controller.signal;
    if (signal.aborted) return;
    const group = groups.filter(item => item.turn.role === 'user' && item.turn.text.trim() &&
      item.start <= current.offset + 350 && item.end >= current.offset - 10_000)
      .sort((a, b) => b.start - a.start)[0];
    current.group = group;
    try {
      if (!group) {
        send('session.commentary.append', { delegation_id: current.id, content: 'Pide que repita la consulta jurídica porque no se entendió completa.' });
        return;
      }
      const question = group.turn.text.trim();
      if (questions.get(group) === question) return;
      questions.set(group, question);
      const result = await callbacks.lookup(group.turn, signal);
      if (signal.aborted) return;
      const evidence = JSON.stringify({ respuesta: result.text, fuentes: result.sources });
      const parts = evidence.match(/[\s\S]{1,700}/gu) || [];
      await Promise.all(parts.map(part => appendContext('Dato de la biblioteca jurídica: ' + part, current.id, signal)));
      if (signal.aborted) return;
      if (send('session.commentary.append', { delegation_id: current.id, content: result.sources?.length
        ? 'Explica la respuesta jurídica verificada que acaba de entregar la biblioteca. Cita las fuentes disponibles y conserva sus límites.'
        : 'Comunica el estado de la verificación que acaba de entregar la biblioteca. Evita afirmar conclusiones jurídicas.' })) {
        callbacks.onEvidence(result);
      }
    } catch {
      if (!signal.aborted) {
        send('session.commentary.append', { delegation_id: current.id, content: 'Explica que la verificación jurídica falló y que puede volver a intentarlo. Evita afirmar datos jurídicos.' });
        callbacks.onEvidence({ text: 'No se pudo completar la verificación en la biblioteca.', sources: [], evidence: [] });
      }
    } finally {
      current.controller.abort();
      if (task === current) {
        task = undefined;
        callbacks.onLookup(false);
      }
    }
  }

  function delegate(event) {
    const { delegation, offset_ms: offset } = event;
    const id = delegation?.id;
    if (delegation?.target !== 'client' || typeof id !== 'string' || !Number.isFinite(offset) || delegationIds.has(id)) return;
    delegationIds.add(id);
    if (task?.offset >= offset) return;
    const earlier = groups.findLast(item => item.turn.role === 'user' &&
      item.start <= offset + 350 && item.end >= offset - 10_000);
    if (earlier && questions.get(earlier) === earlier.turn.text.trim()) return;
    cancelLookup();
    const current = { id, offset, controller: new AbortController(), group: earlier };
    task = current;
    callbacks.onLookup(true);
    send('session.thinking.append', { delegation_id: id, content: '' });
    current.timer = setTimeout(() => void lookup(current), 140);
  }

  function receive({ data }) {
    let event;
    try { event = JSON.parse(data); } catch { return; }
    if (!event || typeof event.type !== 'string') return;
    if (signal.aborted) {
      if (event.type === 'session.closed') dispose();
      return;
    }
    if (event.event_id) {
      if (received.has(event.event_id)) return;
      received.add(event.event_id);
    }
    switch (event.type) {
      case 'session.started':
        if (!ready) {
          ready = true;
          clearTimeout(setupTimeout);
          callbacks.onState('connected');
        }
        break;
      case 'session.input_transcript.delta':
        transcript(event, 'user');
        break;
      case 'session.output_transcript.delta':
        transcript(event, 'assistant');
        break;
      case 'session.delegation.created':
        delegate(event);
        break;
      case 'session.thinking.appended':
        acks.get(event.client_event_id)?.();
        break;
      case 'error':
      case 'session.error': {
        const settle = acks.get(event.client_event_id || event.error?.client_event_id);
        const error = new Error('La sesión de voz rechazó una operación.');
        if (settle) settle(error);
        else if (!ready) fail(error);
        break;
      }
      case 'session.closed':
        fail(new Error('La llamada terminó. Puedes retomarla desde el historial.'));
        break;
    }
  }

  async function connect() {
    let stream;
    try {
      peer = new RTCPeerConnection();
      channel = peer.createDataChannel('oai-events');
      channel.addEventListener('message', receive);
      channel.addEventListener('close', () => {
        if (signal.aborted) dispose();
        else fail(new Error('Se cerró el canal de voz. Puedes retomar la llamada.'));
      });
      peer.addEventListener('track', event => {
        if (!signal.aborted && event.track.kind === 'audio') callbacks.onRemote(new MediaStream([event.track]));
      });
      peer.addEventListener('connectionstatechange', () => {
        if (signal.aborted) return;
        clearTimeout(recoveryTimeout);
        if (peer.connectionState === 'failed') fail(new Error('Se perdió la conexión de voz.'));
        if (peer.connectionState === 'disconnected') {
          callbacks.onState('reconnecting');
          recoveryTimeout = setTimeout(() => fail(new Error('Se perdió la conexión de voz. Puedes retomarla.')), 8000);
        }
        if (peer.connectionState === 'connected' && ready) callbacks.onState('connected');
      });
      stream = await connectMicrophone();
      if (signal.aborted) return;
      useMicrophone(stream);
      sender = peer.addTrack(track, stream);
      setupTimeout = setTimeout(() => fail(new Error('La llamada tardó demasiado en conectar. Inténtalo de nuevo.')), 32_000);
      await peer.setLocalDescription(await peer.createOffer());
      await waitForIce(peer, signal);
      if (signal.aborted) return;
      const answer = await callbacks.negotiate(peer.localDescription.sdp, signal);
      if (!signal.aborted) await peer.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    } catch (error) {
      stream?.getTracks().forEach(item => item.stop());
      fail(error);
    } finally {
      if (signal.aborted) stream?.getTracks().forEach(item => item.stop());
    }
  }

  return {
    connect,
    close,
    mute(value) {
      muted = value;
      if (track) track.enabled = !value;
    },
    interrupt() {
      if (!ready || signal.aborted) return;
      cancelLookup();
      send('session.instructions.append', {
        delegation_id: null,
        content: 'La persona pulsó Interrumpir. Detén la respuesta actual y espera lo que diga a continuación.'
      });
    },
    updateContext(context) {
      if (ready && !signal.aborted) send('session.thinking.append', { delegation_id: null, content: context });
    }
  };
}
