const TIMER_SECONDS = 10;
const URGENT_THRESHOLD = 5;
const RING_CIRCUMFERENCE = 339.3;

let questions = [];
let playOrder = [];
let currentIndex = -1;
let timerInterval = null;
let secondsLeft = TIMER_SECONDS;
let audioCtx = null;
let sessionAnswers = [];

// ---------- Tabs ----------

document.querySelectorAll('.tab-btn').forEach(btn => {
  btn.addEventListener('click', () => switchTab(btn.dataset.tab));
});

function switchTab(tab) {
  if (!document.getElementById(`${tab}-view`).classList.contains('active')) triggerWipe();
  document.querySelectorAll('.tab-btn').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
  document.getElementById(`${tab}-view`).classList.add('active');
  updateCinematic();
  if (tab === 'play') {
    initAudio();
    if (!stages.idle.hidden) {
      startLobbyMusic();
      replayLobbyIntro();
    }
  } else {
    // Leaving mid-question used to leave the clock running: it kept
    // ticking, shaking and flashing, then slammed TIME'S UP over the
    // Setup screen. Stop the round and clear the alarm state.
    freezeRound();
    refreshAnswerLog();
    stopLobbyMusic();
  }
}

// Stop the clock and clear every alarm visual, without logging anything.
function freezeRound() {
  stopTimer();
  document.getElementById('timeup-stamp')?.classList.remove('go');
  document.getElementById('flash-overlay')?.classList.remove(
    'flash-pulse', 'flash-pulse-urgent', 'flash-lock'
  );
  document.querySelector('.stage-border')?.classList.remove('alert');
  document.getElementById('ring-progress')?.classList.remove('urgent');
  document.getElementById('ghost-timer')?.classList.remove('urgent');
  document.getElementById('timer-bar-fill')?.classList.remove('urgent');
  document.getElementById('question-display')?.classList.remove('urgent');
}

// ---------- Storage ----------
// Two backends behind one interface so a single codebase serves both:
//  - published as an Artifact -> the shared document store, so every
//    co-host sees the same questions from their own device
//  - run locally via `npm start` -> the Express JSON API
// `claude.use()` resolves only inside a published page, and never during
// this script's first synchronous run, so the store is initialised in init().

let db = null;
let mode = 'local';   // 'db' | 'rest' | 'local'

const LS_QUESTIONS = 'aiiseh.questions';
const LS_ANSWERS = 'aiiseh.answers';

function lsRead(key) {
  try { return JSON.parse(localStorage.getItem(key)) || []; } catch { return []; }
}
function lsWrite(key, rows) {
  try { localStorage.setItem(key, JSON.stringify(rows)); } catch { /* private mode */ }
}
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

// Questions the game ships with, so it is playable the moment anyone
// opens it. Seeded only on a browser that has never stored a set.
const STARTER_QUESTIONS = [
  'Who is most likely to be late to their own wedding?',
  'Who is most likely to survive a zombie apocalypse?',
  'Who is most likely to become a millionaire?',
  'Who is most likely to forget their own birthday?',
  'Who is most likely to start their own company?',
  'Who is most likely to win a dance-off?',
  'Who is most likely to fall asleep in a meeting?',
  'Who is most likely to move abroad?',
  'Who is most likely to break the office coffee machine?',
  'Who is most likely to reply to emails at 3am?'
];

async function initStore() {
  // 1. Shared database, when this page was published with it.
  if (window.claude && typeof window.claude.use === 'function') {
    try { db = await window.claude.use('db'); } catch { db = null; }
    if (db) { mode = 'db'; return mode; }
  }
  // 2. The local Express server, when running via `npm start`.
  //    Must be real JSON — a static host answering with an HTML fallback
  //    would otherwise look like a working API and break every call.
  try {
    const res = await fetch('/api/questions', { method: 'GET' });
    if (res.ok && (res.headers.get('content-type') || '').includes('application/json')) {
      const body = await res.json();
      if (Array.isArray(body)) { mode = 'rest'; return mode; }
    }
  } catch { /* no server here */ }
  // 3. Otherwise this browser holds its own copy.
  mode = 'local';
  if (!localStorage.getItem('aiiseh.seeded')) {
    try { localStorage.setItem('aiiseh.seeded', '1'); } catch { /* private mode */ }
    if (!lsRead(LS_QUESTIONS).length) {
      lsWrite(LS_QUESTIONS, STARTER_QUESTIONS.map((text, i) => ({
        id: newId(), text, createdAt: Date.now() + i
      })));
    }
  }
  return mode;
}

// ---------- Sharing a question set ----------
// Plain text, one question per line — readable by a human, and pasteable
// straight into the bulk box. An earlier version passed an encoded blob
// around; it was unreadable and gave no clue where it was meant to go.

function questionsAsText() {
  return questions.map(q => q.text).join('\n');
}

async function restApi(path, options) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options
  });
  if (!res.ok && res.status !== 204) {
    const body = await res.json().catch(() => ({}));
    throw new Error(body.error || `Request failed: ${res.status}`);
  }
  return res.status === 204 ? null : res.json();
}

const docsToRows = snap => snap.docs.map(d => ({ id: d.id, ...d.data() }));

const store = {
  async listQuestions() {
    if (mode === 'db') return docsToRows(await db.collection('questions').orderBy('createdAt').get());
    if (mode === 'rest') return restApi('/api/questions');
    return lsRead(LS_QUESTIONS);
  },
  async addQuestion(text) {
    if (mode === 'db') return void await db.collection('questions').add({ text, createdAt: Date.now() });
    if (mode === 'rest') return void await restApi('/api/questions', { method: 'POST', body: JSON.stringify({ text }) });
    lsWrite(LS_QUESTIONS, [...lsRead(LS_QUESTIONS), { id: newId(), text, createdAt: Date.now() }]);
  },
  async addQuestionsBulk(text) {
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (mode === 'db') {
      let t = Date.now();
      for (const line of lines) await db.collection('questions').add({ text: line, createdAt: t++ });
      return;
    }
    if (mode === 'rest') return void await restApi('/api/questions/bulk', { method: 'POST', body: JSON.stringify({ text }) });
    let t = Date.now();
    lsWrite(LS_QUESTIONS, [...lsRead(LS_QUESTIONS), ...lines.map(l => ({ id: newId(), text: l, createdAt: t++ }))]);
  },
  async replaceQuestions(texts) {
    if (mode === 'db' || mode === 'rest') {
      await this.clearQuestions();
      await this.addQuestionsBulk(texts.join('\n'));
      return;
    }
    let t = Date.now();
    lsWrite(LS_QUESTIONS, texts.map(l => ({ id: newId(), text: l, createdAt: t++ })));
  },
  async updateQuestion(id, text) {
    if (mode === 'db') return void await db.collection('questions').doc(String(id)).update({ text });
    if (mode === 'rest') return void await restApi(`/api/questions/${id}`, { method: 'PUT', body: JSON.stringify({ text }) });
    lsWrite(LS_QUESTIONS, lsRead(LS_QUESTIONS).map(q => String(q.id) === String(id) ? { ...q, text } : q));
  },
  async deleteQuestion(id) {
    if (mode === 'db') return void await db.collection('questions').doc(String(id)).delete();
    if (mode === 'rest') return void await restApi(`/api/questions/${id}`, { method: 'DELETE' });
    lsWrite(LS_QUESTIONS, lsRead(LS_QUESTIONS).filter(q => String(q.id) !== String(id)));
  },
  async clearQuestions() {
    if (mode === 'db') {
      const snap = await db.collection('questions').get();
      for (const d of snap.docs) await db.collection('questions').doc(d.id).delete();
      return;
    }
    if (mode === 'rest') return void await restApi('/api/questions', { method: 'DELETE' });
    lsWrite(LS_QUESTIONS, []);
  },
  async listAnswers() {
    if (mode === 'db') return docsToRows(await db.collection('answers').orderBy('createdAt').get());
    if (mode === 'rest') return restApi('/api/answers');
    return lsRead(LS_ANSWERS);
  },
  async addAnswer(answer) {
    if (mode === 'db') return void await db.collection('answers').add({ ...answer, createdAt: Date.now() });
    if (mode === 'rest') return void await restApi('/api/answers', { method: 'POST', body: JSON.stringify(answer) });
    lsWrite(LS_ANSWERS, [...lsRead(LS_ANSWERS), { id: newId(), ...answer, createdAt: Date.now() }]);
  },
  async renameAnswer(id, name) {
    if (mode === 'db') return void await db.collection('answers').doc(String(id)).update({ name });
    if (mode === 'rest') return void await restApi(`/api/answers/${id}`, { method: 'PUT', body: JSON.stringify({ name }) });
    lsWrite(LS_ANSWERS, lsRead(LS_ANSWERS).map(a => String(a.id) === String(id) ? { ...a, name } : a));
  },
  async deleteAnswer(id) {
    if (mode === 'db') return void await db.collection('answers').doc(String(id)).delete();
    if (mode === 'rest') return void await restApi(`/api/answers/${id}`, { method: 'DELETE' });
    lsWrite(LS_ANSWERS, lsRead(LS_ANSWERS).filter(a => String(a.id) !== String(id)));
  }
};

// ---------- Setup view ----------

async function loadQuestions() {
  questions = await store.listQuestions();
  renderQuestionList();
  resetPlayOrder();
}

function renderQuestionList() {
  const list = document.getElementById('question-list');
  document.getElementById('question-count').textContent = questions.length;
  const shareCount = document.getElementById('share-count');
  if (shareCount) shareCount.textContent = questions.length;
  list.innerHTML = '';
  if (!questions.length) {
    list.innerHTML = '<li class="empty-msg">No questions yet. Add some above.</li>';
    return;
  }
  questions.forEach(q => {
    const li = document.createElement('li');

    // A textarea rather than an input so long questions wrap and stay
    // fully readable instead of scrolling out of a one-line box.
    const input = document.createElement('textarea');
    input.className = 'q-edit';
    input.rows = 1;
    input.value = q.text;
    input.title = 'Click to edit';
    let previousValue = q.text;
    input.addEventListener('focus', () => { previousValue = input.value; });
    input.addEventListener('input', () => autosize(input));
    input.addEventListener('keydown', e => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { input.value = previousValue; autosize(input); input.blur(); }
    });
    input.addEventListener('blur', () => saveQuestionText(q.id, input, previousValue));

    const delBtn = document.createElement('button');
    delBtn.textContent = 'Delete';
    delBtn.className = 'danger';
    delBtn.addEventListener('click', () => deleteQuestion(q.id));

    li.appendChild(input);
    li.appendChild(delBtn);
    list.appendChild(li);
    autosize(input);
  });
}

// Grow a question field to fit its wrapped text.
function autosize(el) {
  el.style.height = 'auto';
  el.style.height = `${el.scrollHeight}px`;
}

async function saveQuestionText(id, inputEl, previousValue) {
  const text = inputEl.value.trim();
  if (!text) { inputEl.value = previousValue; return; }
  if (text === previousValue) return;
  try {
    await store.updateQuestion(id, text);
    // Patch the in-memory list rather than reloading, so editing doesn't
    // re-render the row out from under the cursor. Ids are unchanged, so
    // playOrder and the live question lookup stay valid.
    const q = questions.find(x => String(x.id) === String(id));
    if (q) q.text = text;
    inputEl.value = text;
    inputEl.classList.add('saved');
    setTimeout(() => inputEl.classList.remove('saved'), 900);
  } catch {
    inputEl.value = previousValue;
  }
}

async function deleteQuestion(id) {
  await store.deleteQuestion(id);
  await loadQuestions();
}

document.getElementById('add-single-btn').addEventListener('click', async () => {
  const input = document.getElementById('single-question');
  const text = input.value.trim();
  if (!text) return;
  await store.addQuestion(text);
  input.value = '';
  await loadQuestions();
});

document.getElementById('single-question').addEventListener('keydown', e => {
  if (e.key === 'Enter') document.getElementById('add-single-btn').click();
});

document.getElementById('add-bulk-btn').addEventListener('click', async () => {
  const textarea = document.getElementById('bulk-question');
  const text = textarea.value.trim();
  if (!text) return;
  await store.addQuestionsBulk(text);
  textarea.value = '';
  await loadQuestions();
});

// Destructive actions confirm in-page rather than via window.confirm():
// the published page runs in a sandboxed iframe, which ignores native
// modals outright, so confirm() silently returns false and the click
// appears to do nothing. Click once to arm, again within 4s to commit.
function confirmThen(btn, armedLabel, action, precheck) {
  if (!btn) return;
  const original = btn.textContent;
  let armed = false;
  let timer = null;

  const disarm = () => {
    armed = false;
    clearTimeout(timer);
    btn.textContent = original;
    btn.classList.remove('armed');
  };

  btn.addEventListener('click', async () => {
    if (precheck && !precheck()) return;
    if (!armed) {
      armed = true;
      btn.textContent = armedLabel;
      btn.classList.add('armed');
      timer = setTimeout(disarm, 4000);
      return;
    }
    disarm();
    await action();
  });
}

confirmThen(
  document.getElementById('clear-all-btn'),
  'Tap again to delete',
  async () => {
    await store.clearQuestions();
    await loadQuestions();
    setStatus('bulk-status', 'All questions deleted.', true);
  }
);

// ---------- Play view ----------

const stages = {
  idle: document.getElementById('stage-idle'),
  question: document.getElementById('stage-question'),
  gameover: document.getElementById('stage-gameover')
};

function showStage(name) {
  Object.entries(stages).forEach(([key, el]) => {
    el.hidden = key !== name;
  });
  updateCinematic();
  document.getElementById('ghost-timer').classList.toggle('on', name === 'question');
  document.querySelector('.timer-bar').classList.toggle('on', name === 'question');
  if (name === 'idle') replayLobbyIntro();
}

// The whole Play tab is fullscreen — lobby included.
function updateCinematic() {
  const on = document.getElementById('play-view').classList.contains('active');
  document.getElementById('play-view').classList.toggle('cinematic', on);
  document.body.classList.toggle('cinematic-lock', on);
  if (on) document.querySelector('.stage-border').style.transform = '';
}

// Split the lobby headline into per-letter spans so it can cascade in.
function splitTitleLetters() {
  const el = document.querySelector('.idle-title');
  if (!el) return;
  const text = el.getAttribute('data-text') || el.textContent;
  let i = 0;
  el.innerHTML = text.split(' ').map(word =>
    `<span class="w">${[...word]
      .map(ch => `<span class="l" style="--l:${i++}">${ch}</span>`)
      .join('')}</span>`
  ).join(' ');
}

function replayLobbyIntro() {
  const panel = document.getElementById('stage-idle');
  splitTitleLetters();
  panel.classList.remove('reveal');
  void panel.offsetWidth;
  panel.classList.add('reveal');
}

function triggerWipe() {
  const wipe = document.getElementById('wipe');
  wipe.classList.remove('go');
  void wipe.offsetWidth;
  wipe.classList.add('go');
}

// ---------- Decrypt-style text reveal ----------

const SCRAMBLE_CHARS = '▓▒░#@%&*<>/\\ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
let scrambleFrame = null;

function scrambleReveal(el, finalText, duration = 850) {
  if (scrambleFrame) cancelAnimationFrame(scrambleFrame);
  const start = performance.now();
  el.classList.add('scrambling');

  function tick(now) {
    const progress = Math.min((now - start) / duration, 1);
    const revealCount = progress * finalText.length;
    let out = '';
    for (let i = 0; i < finalText.length; i++) {
      const ch = finalText[i];
      if (ch === ' ') { out += ' '; continue; }
      if (i < revealCount) {
        out += ch;
      } else {
        out += SCRAMBLE_CHARS[Math.floor(Math.random() * SCRAMBLE_CHARS.length)];
      }
    }
    el.textContent = out;
    if (progress < 1) {
      scrambleFrame = requestAnimationFrame(tick);
    } else {
      el.textContent = finalText;
      el.classList.remove('scrambling');
      scrambleFrame = null;
    }
  }
  scrambleFrame = requestAnimationFrame(tick);
}

// ---------- Lobby parallax tilt ----------

document.addEventListener('mousemove', e => {
  const border = document.querySelector('.stage-border');
  const playActive = document.getElementById('play-view').classList.contains('active');
  if (!playActive || stages.idle.hidden) return;
  const r = border.getBoundingClientRect();
  const dx = (e.clientX - (r.left + r.width / 2)) / (r.width / 2);
  const dy = (e.clientY - (r.top + r.height / 2)) / (r.height / 2);
  const clamp = v => Math.max(-1, Math.min(1, v));
  border.style.transform =
    `perspective(1400px) rotateY(${clamp(dx) * 4}deg) rotateX(${clamp(-dy) * 4}deg)`;
});

const IDLE_SUB_DEFAULT = document.querySelector('.idle-sub').innerHTML;

function resetPlayOrder() {
  playOrder = questions.map(q => q.id);
  currentIndex = -1;
  sessionAnswers = [];
  stopTimer();
  updateProgress();
  resetRing();
  showStage('idle');
  document.querySelector('.idle-sub').innerHTML = IDLE_SUB_DEFAULT;
  const startBtn = document.getElementById('start-btn');
  const idleHint = document.getElementById('idle-hint');
  startBtn.disabled = !questions.length;
  startBtn.style.opacity = questions.length ? '1' : '0.5';
  startBtn.style.pointerEvents = questions.length ? 'auto' : 'none';
  idleHint.style.display = questions.length ? 'none' : 'block';
  document.getElementById('dossier-count').textContent =
    String(questions.length).padStart(2, '0');
  document.getElementById('logged-for-question').textContent = '';
  document.getElementById('answer-name').value = '';
  if (document.getElementById('play-view').classList.contains('active')) startLobbyMusic();
}

function shuffleArray(arr) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

document.getElementById('shuffle-btn').addEventListener('click', () => {
  playOrder = shuffleArray(playOrder);
  currentIndex = -1;
  // Shuffling restarts the run from the top, so the names logged in the
  // abandoned run must go too — otherwise they reappear in the debrief
  // at the end of the *next* run.
  sessionAnswers = [];
  freezeRound();
  resetRing();
  showStage('idle');
  document.getElementById('idle-hint').style.display = 'none';
  document.querySelector('.idle-sub').textContent =
    'Order shuffled — the run restarts from the first target.';
});

document.getElementById('restart-btn').addEventListener('click', () => {
  resetPlayOrder();
});
document.getElementById('gameover-restart-btn').addEventListener('click', () => {
  resetPlayOrder();
});

document.getElementById('start-btn').addEventListener('click', () => {
  initAudio();
  advanceQuestion();
});
document.getElementById('next-btn').addEventListener('click', () => {
  initAudio();
  advanceQuestion();
});

function currentQuestion() {
  if (currentIndex < 0 || currentIndex >= playOrder.length) return null;
  const id = playOrder[currentIndex];
  return questions.find(q => q.id === id) || null;
}

function advanceQuestion() {
  const wasIdle = currentIndex === -1;
  stopTimer();
  currentIndex++;
  document.getElementById('logged-for-question').textContent = '';
  document.getElementById('answer-name').value = '';

  if (wasIdle) {
    stopLobbyMusic();
    playMissionStinger();
  }

  if (currentIndex >= playOrder.length) {
    document.getElementById('gameover-stats').textContent =
      `All ${playOrder.length} target${playOrder.length === 1 ? '' : 's'} identified. Great work, Agent.`;
    renderDebrief();
    showStage('gameover');
    resetRing();
    replayGameoverAnimations();
    launchConfetti();
    playVictoryJingle();
    return;
  }

  const q = currentQuestion();
  if (!q) {                     // list changed underneath us — rebuild and bail out
    resetPlayOrder();
    return;
  }
  showStage('question');
  triggerWipe();

  // replay the reticle draw-in for every new target
  const panel = document.getElementById('stage-question');
  panel.classList.remove('reveal');
  void panel.offsetWidth;
  panel.classList.add('reveal');

  const display = document.getElementById('question-display');
  display.classList.remove('urgent');
  scrambleReveal(display, q.text);
  updateProgress();
  startTimer();
  document.getElementById('answer-name').focus();
}

function renderDebrief() {
  const list = document.getElementById('gameover-list');
  list.innerHTML = '';
  if (!sessionAnswers.length) {
    list.innerHTML = '<li class="empty-msg">No names were logged this mission.</li>';
    return;
  }
  sessionAnswers.forEach((a, i) => {
    const li = document.createElement('li');
    li.style.setProperty('--i', i);
    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = a.questionText;
    const n = document.createElement('span');
    n.className = 'n';
    n.textContent = a.name;
    li.appendChild(q);
    li.appendChild(n);
    list.appendChild(li);
  });
}

function replayGameoverAnimations() {
  const panel = document.getElementById('stage-gameover');
  panel.classList.remove('play');
  void panel.offsetWidth;
  panel.classList.add('play');
}

function updateProgress() {
  const shown = Math.max(0, Math.min(currentIndex + 1, playOrder.length));
  const pad = n => String(n).padStart(2, '0');
  document.getElementById('progress').textContent = `TARGET ${pad(shown)} / ${pad(playOrder.length)}`;
}

// ---------- Timer ----------

function resetRing() {
  const ring = document.getElementById('ring-progress');
  ring.style.strokeDashoffset = '0';
  ring.classList.remove('urgent');
  document.getElementById('timer-num').textContent = TIMER_SECONDS;
  document.querySelector('.game-stage')?.classList.remove('urgent-phase');
  document.querySelector('.stage-border')?.classList.remove('alert');
  const ghost = document.getElementById('ghost-timer');
  ghost.textContent = TIMER_SECONDS;
  ghost.classList.remove('urgent', 'locked');
  document.getElementById('question-display').classList.remove('urgent');
}

function startTimer() {
  secondsLeft = TIMER_SECONDS;
  const ring = document.getElementById('ring-progress');
  const num = document.getElementById('timer-num');
  const stage = document.querySelector('.game-stage');
  const ghost = document.getElementById('ghost-timer');
  const bar = document.getElementById('timer-bar-fill');
  ring.classList.remove('urgent');
  stage.classList.remove('urgent-phase');
  ghost.classList.remove('urgent', 'locked');
  bar.classList.remove('urgent');
  document.querySelector('.stage-border').classList.remove('alert');
  document.getElementById('logged-for-question').classList.remove('pop');
  ring.style.strokeDashoffset = '0';
  num.textContent = secondsLeft;
  ghost.textContent = secondsLeft;
  bar.style.transition = 'none';
  bar.style.width = '100%';
  void bar.offsetWidth;
  bar.style.transition = '';
  playTick(false);

  timerInterval = setInterval(() => {
    secondsLeft--;
    const offset = RING_CIRCUMFERENCE * (1 - secondsLeft / TIMER_SECONDS);
    ring.style.strokeDashoffset = String(offset);
    const shown = Math.max(secondsLeft, 0);
    num.textContent = shown;
    ghost.textContent = shown;
    bar.style.width = `${(shown / TIMER_SECONDS) * 100}%`;

    const urgent = secondsLeft <= URGENT_THRESHOLD && secondsLeft > 0;
    if (urgent) {
      ring.classList.add('urgent');
      stage.classList.add('urgent-phase');
      ghost.classList.add('urgent');
      bar.classList.add('urgent');
      document.querySelector('.stage-border').classList.add('alert');
      document.getElementById('question-display').classList.add('urgent');
      playTick(true);
    } else if (secondsLeft > 0) {
      playTick(false);
    }
    if (secondsLeft > 0) triggerTick(urgent);

    if (secondsLeft <= 0) {
      stopTimer();
      triggerTick(true);
      timeUp();
    }
  }, 1000);
}

function timeUp() {
  const stamp = document.getElementById('timeup-stamp');
  stamp.classList.remove('go');
  void stamp.offsetWidth;
  stamp.classList.add('go');
  setTimeout(() => stamp.classList.remove('go'), 1800);
  playTimeUp();
}

// Freeze the round the instant a name is called in.
function lockIn() {
  stopTimer();
  const ghost = document.getElementById('ghost-timer');
  ghost.classList.remove('urgent');
  ghost.classList.add('locked');
  document.getElementById('ring-progress').classList.remove('urgent');
  document.getElementById('question-display').classList.remove('urgent');
  document.querySelector('.game-stage').classList.remove('urgent-phase');
  document.getElementById('timer-bar-fill').classList.remove('urgent');
  document.querySelector('.stage-border').classList.remove('alert');

  const flash = document.getElementById('flash-overlay');
  flash.classList.remove('flash-pulse', 'flash-pulse-urgent', 'flash-lock');
  void flash.offsetWidth;
  flash.classList.add('flash-lock');

  const logged = document.getElementById('logged-for-question');
  logged.classList.remove('pop');
  void logged.offsetWidth;
  logged.classList.add('pop');

  playLockIn();
}

function triggerTick(urgent) {
  const stage = document.querySelector('.game-stage');
  const num = document.getElementById('timer-num');
  const flash = document.getElementById('flash-overlay');
  const ghost = document.getElementById('ghost-timer');

  stage.classList.remove('tick-shake', 'tick-shake-urgent');
  void stage.offsetWidth;
  stage.classList.add(urgent ? 'tick-shake-urgent' : 'tick-shake');

  ghost.classList.remove('beat');
  void ghost.offsetWidth;
  ghost.classList.add('beat');

  num.classList.remove('tick-punch', 'tick-punch-urgent');
  void num.offsetWidth;
  num.classList.add(urgent ? 'tick-punch-urgent' : 'tick-punch');

  flash.classList.remove('flash-pulse', 'flash-pulse-urgent');
  void flash.offsetWidth;
  flash.classList.add(urgent ? 'flash-pulse-urgent' : 'flash-pulse');
}

function stopTimer() {
  if (timerInterval) {
    clearInterval(timerInterval);
    timerInterval = null;
  }
  document.querySelector('.game-stage')?.classList.remove('urgent-phase');
}

// ---------- Sound (Web Audio API, no asset files needed) ----------

let muted = false;

function initAudio() {
  if (!audioCtx) {
    audioCtx = new (window.AudioContext || window.webkitAudioContext)();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playTone(freq, duration, type = 'sine', gainValue = 0.15, delay = 0) {
  if (!audioCtx || muted) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  osc.type = type;
  osc.frequency.value = freq;
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  const now = audioCtx.currentTime + delay;
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(gainValue, now + 0.02);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + duration);
  osc.start(now);
  osc.stop(now + duration + 0.02);
}

function playTick(urgent) {
  playTone(urgent ? 880 : 660, urgent ? 0.12 : 0.08, 'square', urgent ? 0.12 : 0.07);
}

function playBuzzer() {
  if (!audioCtx) return;
  playTone(220, 0.5, 'sawtooth', 0.18);
  playTone(160, 0.5, 'sawtooth', 0.18, 0.15);
}

// Rising two-note confirm — "target locked".
function playLockIn() {
  if (!audioCtx || muted) return;
  playHat(0.07);
  playTone(660, 0.12, 'square', 0.16);
  playTone(988, 0.26, 'triangle', 0.17, 0.09);
  playTone(1318, 0.3, 'sine', 0.12, 0.18);
}

// Descending alarm sweep + impact — the file burns.
function playTimeUp() {
  if (!audioCtx || muted) return;
  const osc = audioCtx.createOscillator();
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime;
  osc.type = 'sawtooth';
  osc.frequency.setValueAtTime(520, now);
  osc.frequency.exponentialRampToValueAtTime(60, now + 0.9);
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.24, now + 0.04);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.95);
  osc.connect(gain);
  gain.connect(audioCtx.destination);
  osc.start(now);
  osc.stop(now + 1);

  playHat(0.2);
  playTone(98, 0.7, 'square', 0.2, 0.02);
  playTone(65, 0.8, 'sawtooth', 0.16, 0.06);
}

// ---------- Lobby music + stingers ----------

const muteBtn = document.getElementById('mute-btn');
muteBtn.addEventListener('click', () => {
  initAudio();
  muted = !muted;
  muteBtn.classList.toggle('is-muted', muted);
  if (muted) stopLobbyMusic();
  else if (!stages.idle.hidden && document.getElementById('play-view').classList.contains('active')) startLobbyMusic();
});

// Also try to unlock audio on the very first tap anywhere, in case a browser
// doesn't treat the tab-switch click as enough of a gesture.
document.addEventListener('pointerdown', () => initAudio(), { once: true });

let noiseBuffer = null;
function getNoiseBuffer() {
  if (!noiseBuffer && audioCtx) {
    const size = audioCtx.sampleRate * 0.12;
    noiseBuffer = audioCtx.createBuffer(1, size, audioCtx.sampleRate);
    const data = noiseBuffer.getChannelData(0);
    for (let i = 0; i < size; i++) data[i] = Math.random() * 2 - 1;
  }
  return noiseBuffer;
}

function playHat(gainValue = 0.09, delay = 0) {
  if (!audioCtx || muted) return;
  const buffer = getNoiseBuffer();
  if (!buffer) return;
  const src = audioCtx.createBufferSource();
  src.buffer = buffer;
  const filter = audioCtx.createBiquadFilter();
  filter.type = 'highpass';
  filter.frequency.value = 5500;
  const gain = audioCtx.createGain();
  const now = audioCtx.currentTime + delay;
  gain.gain.setValueAtTime(gainValue, now);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.055);
  src.connect(filter);
  filter.connect(gain);
  gain.connect(audioCtx.destination);
  src.start(now);
  src.stop(now + 0.06);
}

let musicTimer = null;
let musicStep = 0;
// Tense minor-key spy bassline + arpeggio + hi-hat, spread over a 16-step loop.
const BASS_NOTES = [220, 0, 0, 220, 0, 261.63, 0, 0, 196, 0, 0, 196, 0, 233.08, 0, 0];
const ARP_NOTES = [0, 0, 880, 0, 0, 0, 1046.5, 0, 0, 0, 784, 0, 0, 0, 932.33, 0];
const HAT_STEPS = [0, 4, 8, 12];

function scheduleMusicStep() {
  if (muted || !audioCtx) return;
  const bass = BASS_NOTES[musicStep % BASS_NOTES.length];
  if (bass) playTone(bass, 0.24, 'sawtooth', 0.22);
  const arp = ARP_NOTES[musicStep % ARP_NOTES.length];
  if (arp) playTone(arp, 0.14, 'triangle', 0.1);
  if (HAT_STEPS.includes(musicStep % 16)) playHat(0.08);
  musicStep++;
}

function startLobbyMusic() {
  if (musicTimer || muted) return;
  initAudio();
  if (audioCtx.state === 'suspended') audioCtx.resume();
  musicStep = 0;
  scheduleMusicStep();
  musicTimer = setInterval(scheduleMusicStep, 190);
  document.getElementById('music-indicator')?.classList.add('on');
}

function stopLobbyMusic() {
  if (musicTimer) {
    clearInterval(musicTimer);
    musicTimer = null;
  }
  document.getElementById('music-indicator')?.classList.remove('on');
}

function playMissionStinger() {
  if (!audioCtx || muted) return;
  playTone(196, 0.18, 'sawtooth', 0.16);
  playTone(293.66, 0.28, 'sawtooth', 0.14, 0.16);
  playTone(392, 0.4, 'square', 0.12, 0.32);
}

function playVictoryJingle() {
  if (!audioCtx || muted) return;
  [392, 493.88, 587.33, 783.99].forEach((freq, i) => {
    playTone(freq, 0.3, 'triangle', 0.14, i * 0.12);
  });
}

// ---------- Answer logging ----------

document.getElementById('log-answer-btn').addEventListener('click', logAnswer);
document.getElementById('answer-name').addEventListener('keydown', e => {
  if (e.key === 'Enter') logAnswer();
});

async function logAnswer() {
  const q = currentQuestion();
  if (!q) return;
  const input = document.getElementById('answer-name');
  const name = input.value.trim();
  if (!name) return;

  // Freeze the clock immediately — before the network round-trip.
  document.getElementById('logged-for-question').textContent = `LOCKED: ${name}`;
  input.value = '';
  lockIn();

  // The name is shown as locked before the write completes, so a failed
  // write has to say so rather than leave the screen claiming success.
  try {
    await store.addAnswer({ questionId: q.id, questionText: q.text, name });
    sessionAnswers.push({ questionText: q.text, name });
    await refreshAnswerLog();
  } catch {
    document.getElementById('logged-for-question').textContent =
      `COULD NOT SAVE: ${name}`;
  }
}

async function refreshAnswerLog() {
  const answers = await store.listAnswers();
  const list = document.getElementById('answer-log');
  list.innerHTML = '';
  if (!answers.length) {
    list.innerHTML = '<li class="empty-msg">No answers logged yet.</li>';
    return;
  }
  answers.slice().reverse().forEach(a => {
    const li = document.createElement('li');
    li.dataset.id = a.id;

    const q = document.createElement('span');
    q.className = 'q';
    q.textContent = a.questionText;
    q.title = a.questionText;

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.className = 'n-edit';
    nameInput.value = a.name;
    nameInput.autocomplete = 'off';
    let previousValue = a.name;
    nameInput.addEventListener('focus', () => { previousValue = nameInput.value; });
    nameInput.addEventListener('keydown', e => {
      if (e.key === 'Enter') nameInput.blur();
      if (e.key === 'Escape') { nameInput.value = previousValue; nameInput.blur(); }
    });
    nameInput.addEventListener('blur', () => saveAnswerName(a.id, nameInput, previousValue));

    const delBtn = document.createElement('button');
    delBtn.className = 'row-del';
    delBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"><line x1="5" y1="5" x2="19" y2="19"/><line x1="19" y1="5" x2="5" y2="19"/></svg>';
    delBtn.title = 'Delete entry';
    delBtn.addEventListener('click', () => deleteAnswer(a.id));

    li.appendChild(q);
    li.appendChild(nameInput);
    li.appendChild(delBtn);
    list.appendChild(li);
  });
}

async function saveAnswerName(id, inputEl, previousValue) {
  const name = inputEl.value.trim();
  if (!name) {
    inputEl.value = previousValue;
    return;
  }
  if (name === previousValue) return;
  try {
    await store.renameAnswer(id, name);
    inputEl.value = name;
  } catch (err) {
    inputEl.value = previousValue;
  }
}

async function deleteAnswer(id) {
  await store.deleteAnswer(id);
  await refreshAnswerLog();
}

// ---------- Confetti ----------

function launchConfetti() {
  const layer = document.getElementById('confetti-layer');
  if (!layer) return;
  layer.innerHTML = '';
  const colors = ['#3b82f6', '#60a5fa', '#22d3ee', '#818cf8', '#ffffff', '#f87171'];
  const pieces = 110;
  for (let i = 0; i < pieces; i++) {
    const el = document.createElement('span');
    el.className = 'confetti-piece';
    const size = 5 + Math.random() * 8;
    el.style.width = `${size}px`;
    el.style.height = `${size * 0.4}px`;
    el.style.left = `${Math.random() * 100}vw`;
    el.style.background = colors[Math.floor(Math.random() * colors.length)];
    el.style.animationDuration = `${1.8 + Math.random() * 2.2}s`;
    el.style.animationDelay = `${Math.random() * 0.5}s`;
    el.style.transform = `rotate(${Math.random() * 360}deg)`;
    layer.appendChild(el);
    setTimeout(() => el.remove(), 5000);
  }
}

// ---------- Depth field (3D dust drifting toward the viewer) ----------

(function depthField() {
  const canvas = document.getElementById('depth-field');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');
  let w = 0, h = 0, particles = [];
  let camX = 0, camY = 0, targetX = 0, targetY = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth;
    h = canvas.clientHeight;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    seed();
  }

  function seed() {
    const count = Math.max(40, Math.min(150, Math.round((w * h) / 13000)));
    particles = Array.from({ length: count }, () => ({
      x: (Math.random() - 0.5) * 2,
      y: (Math.random() - 0.5) * 2,
      z: Math.random() * 0.98 + 0.02,
      cyan: Math.random() > 0.72
    }));
  }

  function frame() {
    camX += (targetX - camX) * 0.05;
    camY += (targetY - camY) * 0.05;
    ctx.clearRect(0, 0, w, h);
    const cx = w / 2, cy = h / 2;

    for (const p of particles) {
      p.z -= 0.0015;
      if (p.z <= 0.02) {
        p.z = 1;
        p.x = (Math.random() - 0.5) * 2;
        p.y = (Math.random() - 0.5) * 2;
      }
      const scale = 1 / p.z;
      const depth = 1 - p.z;
      const px = cx + p.x * cx * scale * 0.55 + camX * depth * 46;
      const py = cy + p.y * cy * scale * 0.55 + camY * depth * 46;
      if (px < -40 || px > w + 40 || py < -40 || py > h + 40) continue;
      const r = Math.max(0.35, depth * 2.3);
      const a = Math.min(0.6, depth * 0.7);
      ctx.beginPath();
      ctx.arc(px, py, r, 0, Math.PI * 2);
      ctx.fillStyle = p.cyan ? `rgba(23,224,240,${a})` : `rgba(120,170,255,${a * 0.85})`;
      ctx.fill();
    }
    requestAnimationFrame(frame);
  }

  document.addEventListener('mousemove', e => {
    targetX = (e.clientX / window.innerWidth - 0.5) * 2;
    targetY = (e.clientY / window.innerHeight - 0.5) * 2;
  });
  window.addEventListener('resize', resize);
  resize();
  requestAnimationFrame(frame);
})();

// ---------- Telemetry clock ----------

setInterval(() => {
  const el = document.getElementById('tel-clock');
  if (!el) return;
  const d = new Date();
  const pad = n => String(n).padStart(2, '0');
  el.textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}, 1000);

// ---------- Init ----------

(async function init() {
  await initStore();
  await loadQuestions();
  await refreshAnswerLog();
})();

// ---------- Share button ----------

document.getElementById('share-btn')?.addEventListener('click', async () => {
  if (!questions.length) { setStatus('share-status', 'Add some questions first.', false); return; }
  const text = questionsAsText();
  try {
    await navigator.clipboard.writeText(text);
    setStatus('share-status', `Copied ${questions.length} questions.`, true);
  } catch {
    // Clipboard blocked — drop them into the bulk box so they can be copied by hand.
    const box = document.getElementById('bulk-question');
    box.value = text;
    box.focus();
    box.select();
    setStatus('share-status', 'Clipboard blocked — copy them from the box above.', false);
  }
});

const bulkLines = () => document.getElementById('bulk-question')
  .value.split('\n').map(l => l.trim()).filter(Boolean);

confirmThen(
  document.getElementById('replace-bulk-btn'),
  'Tap again to replace',
  async () => {
    const lines = bulkLines();
    await store.replaceQuestions(lines);
    document.getElementById('bulk-question').value = '';
    await loadQuestions();
    setStatus('bulk-status', `Replaced with ${lines.length} questions.`, true);
  },
  () => {
    if (bulkLines().length) return true;
    setStatus('bulk-status', 'Paste some questions first.', false);
    return false;
  }
);

function setStatus(id, msg, ok) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle('ok', !!ok);
  el.classList.toggle('bad', !ok);
  setTimeout(() => { el.textContent = ''; el.classList.remove('ok', 'bad'); }, 3500);
}
