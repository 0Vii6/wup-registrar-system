const express = require('express');
const crypto = require('crypto');
const path = require('path');
const db = require('./db');
const { hashPassword, verifyPassword } = require('./hash');

const app = express();
app.set('trust proxy', 1); // Render sits behind a proxy; needed so the Secure cookie flag works over https
app.use(express.json({ limit: '20mb' })); // assessment photos come in as base64 data URIs
app.use(express.static(path.join(__dirname, 'public')));

// ---------- helpers ----------

function nowTime() {
  return new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function getFullRequest(ref) {
  const row = db.prepare('SELECT * FROM requests WHERE ref = ?').get(ref);
  if (!row) return null;

  const student = db.prepare('SELECT name, course FROM students WHERE id = ?').get(row.student_id);
  const items = db.prepare('SELECT name, copies FROM request_items WHERE ref = ?').all(ref);
  const timeline = db.prepare('SELECT title, time FROM request_timeline WHERE ref = ? ORDER BY id ASC').all(ref);

  return {
    ref: row.ref,
    studentId: row.student_id,
    studentName: student ? student.name : row.student_id,
    course: student ? student.course : '',
    items,
    orNumber: row.or_number,
    assessmentPhoto: row.assessment_photo,
    clearancePhoto: row.clearance_photo || '',
    status: row.status,
    rejectionReason: row.rejection_reason,
    dateSubmitted: row.date_submitted,
    timeline
  };
}

function getAllRequests({ studentId } = {}) {
  const rows = studentId
    ? db.prepare('SELECT ref FROM requests WHERE student_id = ? ORDER BY rowid DESC').all(studentId)
    : db.prepare('SELECT ref FROM requests ORDER BY rowid DESC').all();
  return rows.map(r => getFullRequest(r.ref));
}

function addTimelineAndStatus(ref, status, title) {
  db.prepare('UPDATE requests SET status = ? WHERE ref = ?').run(status, ref);
  db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)').run(ref, title, nowTime());
}

function nextRef() {
  const year = new Date().getFullYear();
  const prefix = `DOC-${year}-`;
  const count = db.prepare('SELECT COUNT(*) AS c FROM requests WHERE ref LIKE ?').get(prefix + '%').c;
  return `${prefix}${1000 + count + 1}`;
}

// Documents that require an additional Clearance Requirement upload on top of the Assessment Form.
// Must match the exact document names used in the frontend's DOC_CATALOG.
const CLEARANCE_REQUIRED_DOCS = [
  'Transcript of Records (TOR)',
  'Certificate of Transfer',
  'Good Moral Certificate',
  'Certificate of Completion'
];


// ---------- sessions (keeps people logged in across page refreshes) ----------
// A random token is stored in an httpOnly cookie and in the SQLite `sessions` table.
const SESSION_COOKIE = 'wup_sid';
const SESSION_MS = 12 * 60 * 60 * 1000; // 12 hours — covers a full 8am-5pm registrar shift

function parseCookies(req) {
  const out = {};
  (req.headers.cookie || '').split(';').forEach(part => {
    const i = part.indexOf('=');
    if (i > -1) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  });
  return out;
}

function setSessionCookie(req, res, token, maxAgeMs) {
  const flags = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Lax', `Max-Age=${Math.floor(maxAgeMs / 1000)}`];
  if (req.secure) flags.push('Secure');
  res.setHeader('Set-Cookie', flags.join('; '));
}

function createSession(req, res, role, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, role, user_id, expires_at) VALUES (?, ?, ?, ?)')
    .run(token, role, userId, Date.now() + SESSION_MS);
  setSessionCookie(req, res, token, SESSION_MS);
}

function getSession(req) {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (!token) return null;
  const s = db.prepare('SELECT * FROM sessions WHERE token = ?').get(token);
  if (!s) return null;
  if (s.expires_at < Date.now()) {
    db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
    return null;
  }
  // sliding expiry: stays alive as long as the person keeps using the system
  db.prepare('UPDATE sessions SET expires_at = ? WHERE token = ?').run(Date.now() + SESSION_MS, token);
  return s;
}

function requireLogin(req, res, next) {
  const s = getSession(req);
  if (!s) return res.status(401).json({ error: 'Not logged in.' });
  req.session = s;
  next();
}

function requireStaff(req, res, next) {
  requireLogin(req, res, () => {
    if (req.session.role !== 'staff') return res.status(403).json({ error: 'Registrar staff only.' });
    next();
  });
}

function buildUser(role, id) {
  if (role === 'staff') {
    const st = db.prepare('SELECT * FROM staff WHERE username = ?').get(id);
    return st && { role: 'staff', id: st.username, name: st.name, department: st.department };
  }
  const stu = db.prepare('SELECT * FROM students WHERE id = ?').get(id);
  return stu && {
    role: 'student', id: stu.id, name: stu.name, course: stu.course,
    phoneNumber: stu.phone_number, mustChangePassword: !!stu.must_change_password
  };
}

// clean out expired sessions once an hour
setInterval(() => db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(Date.now()), 60 * 60 * 1000).unref();

// ---------- auth ----------

app.post('/api/login', (req, res) => {
  const username = (req.body.username || '').trim();
  const password = (req.body.password || '').trim();

  if (!username || !password) {
    return res.status(400).json({ error: 'Username and password are required.' });
  }

  const staff = db.prepare('SELECT * FROM staff WHERE username = ?').get(username.toLowerCase());
  if (staff && verifyPassword(password, staff.password_hash)) {
    createSession(req, res, 'staff', staff.username);
    return res.json({
      role: 'staff',
      id: staff.username,
      name: staff.name,
      department: staff.department
    });
  }

  const student = db.prepare('SELECT * FROM students WHERE id = ?').get(username.toUpperCase());
  if (student && verifyPassword(password, student.password_hash)) {
    createSession(req, res, 'student', student.id);
    return res.json({
      role: 'student',
      id: student.id,
      name: student.name,
      course: student.course,
      phoneNumber: student.phone_number,
      mustChangePassword: !!student.must_change_password
    });
  }

  res.status(401).json({ error: 'Invalid credentials.' });
});

// Who is logged in right now? The page calls this on load so a refresh doesn't log people out.
app.get('/api/me', (req, res) => {
  const s = getSession(req);
  const user = s && buildUser(s.role, s.user_id);
  if (!user) return res.status(401).json({ error: 'Not logged in.' });
  res.json(user);
});

app.post('/api/logout', (req, res) => {
  const token = parseCookies(req)[SESSION_COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  setSessionCookie(req, res, '', 0);
  res.json({ success: true });
});

// Change password — requires the current password (used from an already-logged-in session).
app.post('/api/change-password', requireLogin, (req, res) => {
  const { currentPassword, newPassword } = req.body;
  const id = req.session.user_id;     // always the logged-in account, never a value from the browser
  const role = req.session.role;

  if (!id || !role || !currentPassword || !newPassword) {
    return res.status(400).json({ error: 'All fields are required.' });
  }
  if (String(newPassword).length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters.' });
  }

  const table = role === 'staff' ? 'staff' : 'students';
  const keyCol = role === 'staff' ? 'username' : 'id';
  const lookupId = role === 'staff' ? String(id).toLowerCase() : String(id).toUpperCase();

  const row = db.prepare(`SELECT * FROM ${table} WHERE ${keyCol} = ?`).get(lookupId);
  if (!row) return res.status(404).json({ error: 'Account not found.' });

  if (!verifyPassword(currentPassword, row.password_hash)) {
    return res.status(401).json({ error: 'Current password is incorrect.' });
  }

  if (role === 'staff') {
    db.prepare('UPDATE staff SET password_hash = ? WHERE username = ?').run(hashPassword(newPassword), lookupId);
  } else {
    // Changing the password also clears the forced first-login flag for students.
    db.prepare('UPDATE students SET password_hash = ?, must_change_password = 0 WHERE id = ?')
      .run(hashPassword(newPassword), lookupId);
  }
  res.json({ success: true });
});

// ---------- students: staff-managed fields (e.g. phone number for future SMS recovery) ----------

app.patch('/api/students/:id', requireStaff, (req, res) => {
  const id = req.params.id.toUpperCase();
  const { phoneNumber } = req.body;

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(id);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  db.prepare('UPDATE students SET phone_number = ? WHERE id = ?').run((phoneNumber || '').trim(), id);
  const updated = db.prepare('SELECT id, name, course, phone_number FROM students WHERE id = ?').get(id);
  res.json({
    id: updated.id,
    name: updated.name,
    course: updated.course,
    phoneNumber: updated.phone_number
  });
});

// ---------- requests: read ----------

app.get('/api/requests', requireLogin, (req, res) => {
  // students can only ever see their own requests; staff see everything
  const studentId = req.session.role === 'student' ? req.session.user_id : (req.query.studentId || undefined);
  res.json(getAllRequests({ studentId }));
});

app.get('/api/requests/lookup/:ref', requireLogin, (req, res) => {
  const ref = req.params.ref.trim().toUpperCase();
  const match = db.prepare('SELECT ref FROM requests WHERE UPPER(ref) = ?').get(ref);
  if (!match) return res.status(404).json({ error: 'Not found.' });
  const full = getFullRequest(match.ref);
  if (req.session.role === 'student' && full.studentId !== req.session.user_id) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json(full);
});

// ---------- requests: create ----------

app.post('/api/requests', requireLogin, (req, res) => {
  const { items, orNumber, assessmentPhoto, clearancePhoto } = req.body;

  const studentId = req.session.role === 'student' ? req.session.user_id : req.body.studentId;
  if (!studentId || !Array.isArray(items) || items.length === 0 || !orNumber || !assessmentPhoto) {
    return res.status(400).json({ error: 'Missing required fields.' });
  }

  const needsClearance = items.some(it => CLEARANCE_REQUIRED_DOCS.includes(it.name));
  if (needsClearance && !clearancePhoto) {
    return res.status(400).json({ error: 'A Clearance Requirement upload is required for one or more of the selected documents.' });
  }

  const student = db.prepare('SELECT id FROM students WHERE id = ?').get(studentId);
  if (!student) return res.status(404).json({ error: 'Student not found.' });

  const ref = nextRef();
  const dateSubmitted = new Date().toLocaleString();

  db.exec('BEGIN');
  try {
    db.prepare(`
      INSERT INTO requests (ref, student_id, or_number, assessment_photo, clearance_photo, status, rejection_reason, date_submitted)
      VALUES (?, ?, ?, ?, ?, 'pending_verification', '', ?)
    `).run(ref, studentId, orNumber, assessmentPhoto, clearancePhoto || '', dateSubmitted);

    const insertItem = db.prepare('INSERT INTO request_items (ref, name, copies) VALUES (?, ?, ?)');
    items.forEach(it => insertItem.run(ref, it.name, it.copies));

    db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)')
      .run(ref, `Submitted Online with OR ${orNumber} & Assessment Form`, nowTime());

    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    return res.status(500).json({ error: 'Failed to create request.' });
  }

  res.status(201).json(getFullRequest(ref));
});

// ---------- requests: status actions ----------

app.post('/api/requests/:ref/approve-payment', requireStaff, (req, res) => {
  const ref = req.params.ref;
  if (!db.prepare('SELECT ref FROM requests WHERE ref = ?').get(ref)) {
    return res.status(404).json({ error: 'Not found.' });
  }
  addTimelineAndStatus(ref, 'processing', 'OR & Assessment Verified by Registrar; Document In-Processing');
  res.json(getFullRequest(ref));
});

app.post('/api/requests/:ref/mark-ready', requireStaff, (req, res) => {
  const ref = req.params.ref;
  if (!db.prepare('SELECT ref FROM requests WHERE ref = ?').get(ref)) {
    return res.status(404).json({ error: 'Not found.' });
  }
  addTimelineAndStatus(ref, 'ready', 'Ready to Claim at the Registrar Claiming Window');
  res.json(getFullRequest(ref));
});

app.post('/api/requests/:ref/mark-completed', requireStaff, (req, res) => {
  const ref = req.params.ref;
  if (!db.prepare('SELECT ref FROM requests WHERE ref = ?').get(ref)) {
    return res.status(404).json({ error: 'Not found.' });
  }
  addTimelineAndStatus(ref, 'completed', 'Document Claimed at Window Counter');
  res.json(getFullRequest(ref));
});

app.post('/api/requests/:ref/reject', requireStaff, (req, res) => {
  const ref = req.params.ref;
  const reason = (req.body.reason || '').trim();

  if (!reason) return res.status(400).json({ error: 'Rejection reason is required.' });
  if (!db.prepare('SELECT ref FROM requests WHERE ref = ?').get(ref)) {
    return res.status(404).json({ error: 'Not found.' });
  }

  db.prepare('UPDATE requests SET status = ?, rejection_reason = ? WHERE ref = ?').run('rejected', reason, ref);
  db.prepare('INSERT INTO request_timeline (ref, title, time) VALUES (?, ?, ?)')
    .run(ref, `Rejected: ${reason}`, nowTime());

  res.json(getFullRequest(ref));
});

// ---------- debug: view live data without SSH/Shell access (off unless DEBUG_KEY is set) ----------
// Render's free tier has no Shell access, so this is a safe way to peek at the deployed
// database from a browser: visit /api/_debug/data?key=<your DEBUG_KEY>
// Never returns password_hash. Leave DEBUG_KEY unset in production to disable this entirely.
app.get('/api/_debug/data', (req, res) => {
  if (!process.env.DEBUG_KEY || req.query.key !== process.env.DEBUG_KEY) {
    return res.status(404).json({ error: 'Not found.' });
  }
  res.json({
    students: db.prepare('SELECT id, name, course, phone_number, must_change_password FROM students').all(),
    staff: db.prepare('SELECT username, name, department FROM staff').all(),
    requests: db.prepare('SELECT * FROM requests ORDER BY rowid DESC').all(),
    request_items: db.prepare('SELECT * FROM request_items').all(),
    request_timeline: db.prepare('SELECT * FROM request_timeline ORDER BY id ASC').all()
  });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`WUP Registrar System running at http://localhost:${PORT}`);
});
