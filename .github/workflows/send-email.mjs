import https from 'https';
import crypto from 'crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = sa.project_id;
const toEmail = 'wmr77077@gmail.com';
const firestoreHost = 'firestore.googleapis.com';
const dbPath = '/v1/projects/' + projectId + '/databases/(default)';

function request(host, path, method, token, body) {
  return new Promise((resolve, reject) => {
    const opts = { hostname: host, path, method, headers: {} };
    if (token) opts.headers['Authorization'] = 'Bearer ' + token;
    if (body) { opts.headers['Content-Type'] = 'application/json'; opts.headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request(opts, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const j = JSON.parse(data); if (res.statusCode >= 400) reject(new Error(j.error?.message || data)); else resolve(j); }
        catch(e) { reject(new Error(data)); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.auth',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const signer = crypto.createSign('SHA256');
  signer.write(header + '.' + payload);
  signer.end();
  const assertion = header + '.' + payload + '.' + signer.sign(sa.private_key, 'base64url');
  const body = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion);
  return request('oauth2.googleapis.com', '/token', 'POST', null, body).then(r => r.access_token);
}

async function main() {
  try {
    const token = await getAccessToken();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    console.log('Date:', todayStr);

    // 1. نجيب UID المستخدم من Firebase Auth
    const usersResp = await request('identitytoolkit.googleapis.com', '/v1/projects/' + projectId + '/accounts:query', 'POST', token, JSON.stringify({
      returnUserInfo: true, maxResults: 50
    }));
    const uids = (usersResp.userInfo || []).filter(u => u.email === toEmail).map(u => u.localId);
    console.log('UIDs:', uids);

    if (uids.length === 0) {
      console.log('No user found for ' + toEmail);
      return;
    }

    // 2. نجيب المهام لكل UID
    const allTasks = [];
    for (const uid of uids) {
      try {
        const tasksResp = await request(firestoreHost, dbPath + '/documents/users/' + uid + '/tasks', 'GET', token);
        console.log('Tasks for ' + uid + ':', (tasksResp.documents || []).length);
        for (const doc of (tasksResp.documents || [])) {
          const f = doc.fields || {};
          allTasks.push({
            name: f.name?.stringValue || '',
            date: f.date?.stringValue || '',
            status: f.status?.stringValue || '',
            archived: f.archived?.booleanValue || false,
            priority: f.priority?.stringValue || 'medium',
            project: f.project?.stringValue || ''
          });
        }
      } catch(e) {
        console.log('No tasks for', uid, '-', e.message);
      }
    }

    console.log('Total tasks:', allTasks.length);
    const todayTasks = allTasks.filter(t => t.date === todayStr && t.status !== 'completed' && !t.archived);
    const overdueTasks = allTasks.filter(t => t.date < todayStr && t.status !== 'completed' && !t.archived);
    console.log('Today tasks:', todayTasks.length);
    console.log('Overdue tasks:', overdueTasks.length);

    if (todayTasks.length === 0 && overdueTasks.length === 0) {
      console.log('No tasks, skipping email');
      return;
    }

    let body = '';
    if (todayTasks.length) {
      body += '📅 مهام اليوم (' + todayTasks.length + '):\n';
      todayTasks.forEach(t => { body += '- ' + t.name + (t.project ? ' [' + t.project + ']' : '') + '\n'; });
    }
    if (overdueTasks.length) {
      body += '\n🔴 مهام متأخرة (' + overdueTasks.length + '):\n';
      overdueTasks.forEach(t => { body += '- ' + t.name + ' (تاريخها: ' + t.date + ')' + '\n'; });
    }

    // 3. إرسال الإيميل
    await request('formsubmit.co', '/ajax/' + encodeURIComponent(toEmail), 'POST', null, JSON.stringify({ subject: 'Walid Planner - تذكير يومي', message: body }));
    console.log('✅ Email sent to ' + toEmail);
    console.log(body.slice(0, 200));
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
