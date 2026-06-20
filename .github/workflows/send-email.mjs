import https from 'https';
import crypto from 'crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = sa.project_id;
const toEmail = 'wmr77077@gmail.com';
const baseHost = 'firestore.googleapis.com';
const dbPath = '/v1/projects/' + projectId + '/databases/(default)';

function getAccessToken() {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const signer = crypto.createSign('SHA256');
  signer.write(header + '.' + payload);
  signer.end();
  const assertion = header + '.' + payload + '.' + signer.sign(sa.private_key, 'base64url');
  return new Promise((resolve, reject) => {
    const body = 'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion);
    const req = https.request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => { try { resolve(JSON.parse(data).access_token); } catch(e) { reject(new Error('Token: ' + data)); } });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function runQuery(token, query) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify(query);
    const req = https.request({ hostname: baseHost, path: dbPath + '/documents:runQuery', method: 'POST', headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' } }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); } catch(e) { reject(new Error('Query: ' + data)); }
      });
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

function sendEmail(subject, msg) {
  return new Promise((resolve, reject) => {
    const body = JSON.stringify({ subject, message: msg });
    const req = https.request({
      hostname: 'formsubmit.co', path: '/ajax/' + encodeURIComponent(toEmail),
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json', 'Content-Length': Buffer.byteLength(body) }
    }, res => { res.on('data', () => {}); res.on('end', resolve); });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function main() {
  try {
    const token = await getAccessToken();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    console.log('Date:', todayStr);

    // Collection group query: كل المهام في كل المستخدمين
    const result = await runQuery(token, {
      structuredQuery: {
        from: [{ collectionId: 'tasks', allDescendants: true }]
      }
    });

    if (result.error) {
      // لو collection group مش متاح، نجرب query لكل user من التوكن
      console.error('Query error:', result.error.message);
      if (result.error.message.includes('index')) {
        // نحتاج ننشئ index — نقرأ المهام من client-side path بدل كده
        // جرب نجيب المستخدمين من auth
        console.log('Need index, trying alternative...');
        // مؤقتاً: مفيش مهام
        const fallback = await runQuery(token, {
          structuredQuery: {
            from: [{ collectionId: 'users' }],
            select: { fields: [{ fieldPath: '__name__' }] }
          }
        });
        console.log('Users query:', JSON.stringify(fallback).slice(0, 500));
      }
      return;
    }

    const tasks = [];
    for (const row of result) {
      if (row.document && row.document.fields) {
        const f = row.document.fields;
        tasks.push({
          name: f.name?.stringValue || '',
          date: f.date?.stringValue || '',
          status: f.status?.stringValue || '',
          priority: f.priority?.stringValue || 'medium',
          project: f.project?.stringValue || '',
          archived: f.archived?.booleanValue || false
        });
      }
    }

    console.log('Total tasks:', tasks.length);

    const todayTasks = tasks.filter(t => t.date === todayStr && t.status !== 'completed' && !t.archived);
    const overdueTasks = tasks.filter(t => t.date < todayStr && t.status !== 'completed' && !t.archived);

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

    await sendEmail('📋 Walid Planner - تذكير يومي', body);
    console.log('✅ Email sent successfully');
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
