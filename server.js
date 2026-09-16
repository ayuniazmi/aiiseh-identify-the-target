const express = require('express');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const DATA_DIR = path.join(__dirname, 'data');
const QUESTIONS_FILE = path.join(DATA_DIR, 'questions.json');
const ANSWERS_FILE = path.join(DATA_DIR, 'answers.json');

function ensureDataFiles() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
  if (!fs.existsSync(QUESTIONS_FILE)) fs.writeFileSync(QUESTIONS_FILE, '[]');
  if (!fs.existsSync(ANSWERS_FILE)) fs.writeFileSync(ANSWERS_FILE, '[]');
}
ensureDataFiles();

function readJSON(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
function writeJSON(file, data) {
  fs.writeFileSync(file, JSON.stringify(data, null, 2));
}
function nextId(items) {
  return items.reduce((max, i) => Math.max(max, i.id), 0) + 1;
}

app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

// --- Questions CRUD ---

app.get('/api/questions', (req, res) => {
  res.json(readJSON(QUESTIONS_FILE));
});

app.post('/api/questions', (req, res) => {
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  const questions = readJSON(QUESTIONS_FILE);
  const question = { id: nextId(questions), text, createdAt: new Date().toISOString() };
  questions.push(question);
  writeJSON(QUESTIONS_FILE, questions);
  res.status(201).json(question);
});

app.post('/api/questions/bulk', (req, res) => {
  const raw = (req.body.text || '');
  const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);
  if (!lines.length) return res.status(400).json({ error: 'no questions found' });
  const questions = readJSON(QUESTIONS_FILE);
  let id = nextId(questions);
  const created = [];
  for (const line of lines) {
    const q = { id: id++, text: line, createdAt: new Date().toISOString() };
    questions.push(q);
    created.push(q);
  }
  writeJSON(QUESTIONS_FILE, questions);
  res.status(201).json(created);
});

app.put('/api/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  const text = (req.body.text || '').trim();
  if (!text) return res.status(400).json({ error: 'text is required' });
  const questions = readJSON(QUESTIONS_FILE);
  const q = questions.find(q => q.id === id);
  if (!q) return res.status(404).json({ error: 'not found' });
  q.text = text;
  writeJSON(QUESTIONS_FILE, questions);
  res.json(q);
});

app.delete('/api/questions/:id', (req, res) => {
  const id = Number(req.params.id);
  let questions = readJSON(QUESTIONS_FILE);
  const before = questions.length;
  questions = questions.filter(q => q.id !== id);
  if (questions.length === before) return res.status(404).json({ error: 'not found' });
  writeJSON(QUESTIONS_FILE, questions);
  res.status(204).end();
});

app.delete('/api/questions', (req, res) => {
  writeJSON(QUESTIONS_FILE, []);
  res.status(204).end();
});

// --- Answers (log of names called out during play) ---

app.get('/api/answers', (req, res) => {
  res.json(readJSON(ANSWERS_FILE));
});

app.post('/api/answers', (req, res) => {
  const { questionId, questionText, name } = req.body;
  const trimmedName = (name || '').trim();
  if (!trimmedName) return res.status(400).json({ error: 'name is required' });
  const answers = readJSON(ANSWERS_FILE);
  const answer = {
    id: nextId(answers),
    questionId: questionId ?? null,
    questionText: questionText || '',
    name: trimmedName,
    createdAt: new Date().toISOString()
  };
  answers.push(answer);
  writeJSON(ANSWERS_FILE, answers);
  res.status(201).json(answer);
});

app.put('/api/answers/:id', (req, res) => {
  const id = Number(req.params.id);
  const name = (req.body.name || '').trim();
  if (!name) return res.status(400).json({ error: 'name is required' });
  const answers = readJSON(ANSWERS_FILE);
  const answer = answers.find(a => a.id === id);
  if (!answer) return res.status(404).json({ error: 'not found' });
  answer.name = name;
  writeJSON(ANSWERS_FILE, answers);
  res.json(answer);
});

app.delete('/api/answers/:id', (req, res) => {
  const id = Number(req.params.id);
  let answers = readJSON(ANSWERS_FILE);
  const before = answers.length;
  answers = answers.filter(a => a.id !== id);
  if (answers.length === before) return res.status(404).json({ error: 'not found' });
  writeJSON(ANSWERS_FILE, answers);
  res.status(204).end();
});

app.delete('/api/answers', (req, res) => {
  writeJSON(ANSWERS_FILE, []);
  res.status(204).end();
});

app.listen(PORT, () => {
  console.log(`Team Bonding Game running at http://localhost:${PORT}`);
});
