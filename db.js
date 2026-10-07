const { DatabaseSync } = require('node:sqlite');
const path = require('path');
const fs = require('fs');
const { hashPassword } = require('./hash');

// DB_DIR lets you point this at a mounted persistent disk in production (e.g. Render's
// persistent disk feature) without any code changes — just set the env var. Defaults to
// a local ./data folder, which is what runs on the free tier (see README).
const DATA_DIR = process.env.DB_DIR || path.join(__dirname, 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

const DB_PATH = path.join(DATA_DIR, 'wup_registrar.db');
const db = new DatabaseSync(DB_PATH);

db.exec(`
  PRAGMA journal_mode = WAL;
  PRAGMA foreign_keys = ON;

  CREATE TABLE IF NOT EXISTS students (
    id                   TEXT PRIMARY KEY,
    name                 TEXT NOT NULL,
    course               TEXT NOT NULL,
    phone_number         TEXT NOT NULL DEFAULT '',
    password_hash        TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS staff (
    username      TEXT PRIMARY KEY,
    password_hash TEXT NOT NULL,
    name          TEXT NOT NULL,
    department    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS requests (
    ref               TEXT PRIMARY KEY,
    student_id        TEXT NOT NULL REFERENCES students(id),
    or_number         TEXT NOT NULL,
    assessment_photo  TEXT,
    clearance_photo   TEXT NOT NULL DEFAULT '',
    status            TEXT NOT NULL DEFAULT 'pending_verification',
    rejection_reason  TEXT NOT NULL DEFAULT '',
    date_submitted    TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS request_items (
    id     INTEGER PRIMARY KEY AUTOINCREMENT,
    ref    TEXT NOT NULL REFERENCES requests(ref),
    name   TEXT NOT NULL,
    copies INTEGER NOT NULL DEFAULT 1
  );

  CREATE TABLE IF NOT EXISTS request_timeline (
    id    INTEGER PRIMARY KEY AUTOINCREMENT,
    ref   TEXT NOT NULL REFERENCES requests(ref),
    title TEXT NOT NULL,
    time  TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token      TEXT PRIMARY KEY,
    role       TEXT NOT NULL,
    user_id    TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE INDEX IF NOT EXISTS idx_requests_student ON requests(student_id);
  CREATE INDEX IF NOT EXISTS idx_items_ref ON request_items(ref);
  CREATE INDEX IF NOT EXISTS idx_timeline_ref ON request_timeline(ref);
`);

// ---- Seed only on first run (empty database) ----
const studentCount = db.prepare('SELECT COUNT(*) AS c FROM students').get().c;
if (studentCount === 0) {
  seed();
}

function seed() {
  const insertStudent = db.prepare(
    'INSERT INTO students (id, name, course, phone_number, password_hash, must_change_password) VALUES (?, ?, ?, ?, ?, 1)'
  );
  const students = [
    { id: 'WUP-24-1122-112', name: 'Dave Sabite', course: 'BS Information Technology', phone: '' },
    { id: 'WUP-24-1123-132', name: 'Joshua Lleva', course: 'BS Information Technology', phone: '' },
    { id: 'WUP-24-2045-881', name: 'Justine Abello', course: 'BS Business Administration', phone: '' },
    { id: 'WUP-23-0941-008', name: 'Daphne Carvajal', course: 'BS Nursing', phone: '' },
    { id: 'WUP-11-1111-111', name: 'Demo', course: 'BS Information Technology', phone: '' },
    { id: 'WUP-11-1112-112', name: 'Demo1', course: 'BS Information Technology', phone: '' }
  ];
  students.forEach(s => {
    // default password = the numeric part of their ID (e.g. "24-1122-112"), same as before, now hashed.
    // must_change_password starts at 1 — they're forced to set a real password on first login.
    const defaultPassword = s.id.replace(/^WUP-/, '');
    insertStudent.run(s.id, s.name, s.course, s.phone, hashPassword(defaultPassword));
  });

  db.prepare('INSERT INTO staff (username, password_hash, name, department) VALUES (?, ?, ?, ?)')
    .run('registrar_admin', hashPassword('admin123'), 'Jeremiah Miguel Eugenio (Registrar Officer)', 'Office of Records');

  const insertRequest = db.prepare(`
    INSERT INTO requests (ref, student_id, or_number, assessment_photo, status, rejection_reason, date_submitted)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  const insertItem = db.prepare('INSERT INTO request_items (ref, name, copies) VALUES (?, ?, ?)');
  const insertEvent = db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)');

  const seedRequests = [
    {
      ref: 'DOC-2026-1001',
      student_id: 'WUP-24-1122-112',
      or_number: 'OR-2026-88192',
      assessment_photo: 'Assessment_Form_Dave_Sabite_Term1.pdf',
      status: 'ready',
      rejection_reason: '',
      date_submitted: '2026-09-21 09:30 AM',
      items: [
        { name: 'Certificate of Enrollment (COE)', copies: 1 },
        { name: 'Good Moral Certificate', copies: 1 }
      ],
      timeline: [
        { title: 'Submitted Online with OR-2026-88192 & Assessment Form', time: '2026-09-21 09:30 AM' },
        { title: 'Verified by Registrar & Processing', time: '2026-09-22 08:45 AM' },
        { title: 'Ready to Claim at the Registrar Claiming Window', time: '2026-09-23 02:10 PM' }
      ]
    },
    {
      ref: 'DOC-2026-1002',
      student_id: 'WUP-24-1122-112',
      or_number: 'OR-2026-90412',
      assessment_photo: 'Assessment_Dave_Term2.jpg',
      status: 'pending_verification',
      rejection_reason: '',
      date_submitted: '2026-09-24 08:15 AM',
      items: [{ name: 'Certificate of Grades (COG)', copies: 2 }],
      timeline: [
        { title: 'Submitted Online with OR-2026-90412 & Assessment Form', time: '2026-09-24 08:15 AM' }
      ]
    },
    {
      ref: 'DOC-2026-0984',
      student_id: 'WUP-23-0941-008',
      or_number: 'OR-2026-77301',
      assessment_photo: 'Assessment_Form_Daphne.png',
      status: 'pending_verification',
      rejection_reason: '',
      date_submitted: '2026-09-24 10:20 AM',
      items: [{ name: 'Transcript of Records (TOR)', copies: 1 }],
      timeline: [
        { title: 'Submitted Online with OR-2026-77301 & Assessment Form', time: '2026-09-24 10:20 AM' }
      ]
    },
    {
      ref: 'DOC-2026-1033',
      student_id: 'WUP-24-2045-881',
      or_number: 'OR-2026-66410',
      assessment_photo: 'Assessment_Form_Kiffy.jpg',
      status: 'pending_verification',
      rejection_reason: '',
      date_submitted: '2026-09-24 02:30 PM',
      items: [{ name: 'Certificate of Grades (COG)', copies: 1 }],
      timeline: [
        { title: 'Submitted Online with OR-2026-66410 & Assessment Form', time: '2026-09-24 02:30 PM' }
      ]
    }
  ];

  db.exec('BEGIN');
  try {
    for (const r of seedRequests) {
      insertRequest.run(r.ref, r.student_id, r.or_number, r.assessment_photo, r.status, r.rejection_reason, r.date_submitted);
      r.items.forEach(it => insertItem.run(r.ref, it.name, it.copies));
      r.timeline.forEach(ev => insertEvent.run(r.ref, ev.title, ev.time));
    }
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

module.exports = db;
