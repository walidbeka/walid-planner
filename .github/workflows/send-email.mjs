import https from 'https';
import crypto from 'crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = sa.project_id;
const toEmail = 'wmr77077@gmail.com';
const baseUrl = 'firestore.googleapis.com';
const dbPath = '/v1/projects/' + projectId + '/databases/(default)/documents';

function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/firebase.database',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const signer = crypto.createSign('SHA256');
  signer.write(header + '.' + payload);
  signer.end();
  const signature = signer.sign(sa.private_key, 'base64url');
  const assertion = header + '.' + payload + '.' + signature;
  return new Promise((resolve, reject) => {
    const body = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion);
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data).access_token); } catch(e) { reject(new Error('Token error: ' + data)); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function firestoreGet(path, token) {
  return new Promise((resolve, reject) => {
    https.get({ hostname: baseUrl, path: dbPath + path, headers: { 'Authorization': 'Bearer ' + token } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => resolve(JSON.parse(data)));
    }).on('error', reject);
  });
}

async function main() {
  try {
    const token = await getAccessToken();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');

    // 1. جلب كل المستخدمين
    const users = await firestoreGet('', token);
    const userIds = (users.documents || []).map(d => d.name.split('/').pop());
    console.log('Users:', userIds);

    if (userIds.length === 0) {
      console.log('No users found');
      return;
    }

    // 2. جلب المهام لكل مستخدم
    const allTasks = [];
    for (const uid of userIds) {
      const tasksRes = await firestoreGet('/users/' + uid + '/tasks', token);
      for (const doc of (tasksRes.documents || [])) {
        const f = doc.fields || {};
        allTasks.push({
          name: f.name?.stringValue || '',
          date: f.date?.stringValue || '',
          status: f.status?.stringValue || '',
          priority: f.priority?.stringValue || 'medium',
          project: f.project?.stringValue || '',
          archived: f.archived?.booleanValue || false
        });
      }
    }

    console.log('Total tasks:', allTasks.length);

    const todayTasks = allTasks.filter(t => t.date === todayStr && t.status !== 'completed' && !t.archived);
    const overdueTasks = allTasks.filter(t => t.date < todayStr && t.status !== 'completed' && !t.archived);

    if (todayTasks.length === 0 && overdueTasks.length === 0) {
      console.log('No tasks today, skipping');
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
    const postData = JSON.stringify({ subject: '📋 Walid Planner - تذكير يومي', message: body });
    await new Promise((resolve, reject) => {
      const req = https.request({
        hostname: 'formsubmit.co', path: '/ajax/' + encodeURIComponent(toEmail),
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(postData) }
      }, res => {
        let r = '';
        res.on('data', c => r += c);
        res.on('end', () => { console.log('Email sent:', r); resolve(); });
      });
      req.on('error', reject);
      req.write(postData);
      req.end();
    });
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
