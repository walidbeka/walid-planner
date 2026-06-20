import https from 'https';
import crypto from 'crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = sa.project_id;
const toEmail = 'wmr77077@gmail.com';
const firestore = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)';

function api(method, url, token, body, ct) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body) { headers['Content-Type'] = ct || 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const j = JSON.parse(data); if (res.statusCode >= 400) reject({ status: res.statusCode, error: j.error || j }); else resolve(j); }
        catch(e) { reject({ status: res.statusCode, text: data }); }
      });
    });
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

function getToken() {
  const now = Math.floor(Date.now() / 1000);
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const p = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform https://www.googleapis.com/auth/firebase.auth',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const s = crypto.createSign('SHA256'); s.write(h + '.' + p); s.end();
  const a = h + '.' + p + '.' + s.sign(sa.private_key, 'base64url');
  return api('POST', 'https://oauth2.googleapis.com/token', null,
    'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(a),
    'application/x-www-form-urlencoded').then(r => r.access_token);
}

async function main() {
  try {
    const token = await getToken();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    console.log('Date:', todayStr);

    // 1. نجيب UID المستخدم من Firebase Auth
    const authRes = await api('POST', 'https://identitytoolkit.googleapis.com/v1/projects/' + projectId + '/accounts:query', token,
      JSON.stringify({ returnUserInfo: true, maxResults: 100 }));
    const uids = (authRes.userInfo || []).filter(u => u.email === toEmail).map(u => u.localId);
    console.log('Found UIDs:', uids);

    if (uids.length === 0) {
      console.log('No user found for ' + toEmail);
      return;
    }

    // 2. نجيب المهام من كل المستخدمين
    const allTasks = [];
    for (const uid of uids) {
      let pageToken = '';
      while (true) {
        let url = firestore + '/documents/users/' + uid + '/tasks?pageSize=500';
        if (pageToken) url += '&pageToken=' + encodeURIComponent(pageToken);
        const resp = await api('GET', url, token);
        for (const doc of (resp.documents || [])) {
          const f = doc.fields || {};
          allTasks.push({
            name: f.name?.stringValue || '',
            date: f.date?.stringValue || '',
            status: f.status?.stringValue || '',
            archived: f.archived?.booleanValue || false
          });
        }
        pageToken = resp.nextPageToken || '';
        if (!pageToken) break;
      }
      console.log('User ' + uid + ': ' + allTasks.length + ' tasks');
    }

    if (allTasks.length === 0) { console.log('No tasks found'); return; }

    const todayTasks = allTasks.filter(t => t.date === todayStr && t.status !== 'completed' && !t.archived);
    const overdueTasks = allTasks.filter(t => t.date < todayStr && t.status !== 'completed' && !t.archived);

    if (todayTasks.length === 0 && overdueTasks.length === 0) {
      console.log('No pending tasks today');
      return;
    }

    let body = '';
    if (todayTasks.length) { body += '📅 مهام اليوم (' + todayTasks.length + '):\n'; todayTasks.forEach(t => { body += '- ' + t.name + '\n'; }); }
    if (overdueTasks.length) { body += '\n🔴 مهام متأخرة (' + overdueTasks.length + '):\n'; overdueTasks.forEach(t => { body += '- ' + t.name + ' (تاريخها: ' + t.date + ')' + '\n'; }); }

    // 3. إرسال الإيميل
    await api('POST', 'https://formsubmit.co/ajax/' + encodeURIComponent(toEmail), null,
      JSON.stringify({ subject: 'Walid Planner - تذكير يومي', message: body }));
    console.log('✅ Email sent successfully!');
  } catch(e) {
    console.error('Error:', e.error?.message || e.error?.error?.message || JSON.stringify(e).slice(0, 500));
    process.exit(1);
  }
}

main();
