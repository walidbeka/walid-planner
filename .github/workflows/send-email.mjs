import https from 'https';
import crypto from 'crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = sa.project_id;
const toEmail = 'wmr77077@gmail.com';
const dbUrl = '/v1/projects/' + projectId + '/databases/(default)/documents';

function api(method, url, token, body, contentType) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const headers = {};
    if (token) headers['Authorization'] = 'Bearer ' + token;
    if (body) { headers['Content-Type'] = contentType || 'application/json'; headers['Content-Length'] = Buffer.byteLength(body); }
    const req = https.request({ hostname: u.hostname, path: u.pathname + u.search, method, headers }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        try { const j = JSON.parse(data); if (res.statusCode >= 400) reject(new Error(j.error?.message || data)); else resolve(j); }
        catch(e) { reject(new Error(res.statusCode + ': ' + data)); }
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
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const signer = crypto.createSign('SHA256');
  signer.write(header + '.' + payload);
  signer.end();
  const assertion = header + '.' + payload + '.' + signer.sign(sa.private_key, 'base64url');
  return api('POST', 'https://oauth2.googleapis.com/token', null,
    'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(assertion),
    'application/x-www-form-urlencoded').then(r => r.access_token);
}

async function main() {
  try {
    const token = await getAccessToken();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    console.log('Date:', todayStr);

    // قراءة الملخص من reminders/{todayStr}
    const docUrl = 'https://firestore.googleapis.com' + dbUrl + '/reminders/' + todayStr;
    let summary = null;
    try {
      const doc = await api('GET', docUrl, token);
      summary = doc.fields?.body?.stringValue || null;
      console.log('Found summary:', summary ? summary.slice(0, 100) : 'empty');
    } catch(e) {
      console.log('No reminder saved yet:', e.message);
    }

    if (!summary) {
      console.log('No summary to send');
      return;
    }

    // إرسال الإيميل
    await api('POST', 'https://formsubmit.co/ajax/' + encodeURIComponent(toEmail), null,
      JSON.stringify({ subject: 'Walid Planner - تذكير يومي', message: summary }));
    console.log('✅ Email sent!');

    // تحديث sent = true
    const updateUrl = docUrl + '?updateMask.fieldPaths=sent&updateMask.fieldPaths=updatedAt';
    await api('PATCH', updateUrl, token,
      JSON.stringify({ fields: { sent: { booleanValue: true }, updatedAt: { timestampValue: new Date().toISOString() } } }));
    console.log('✅ Reminder marked as sent');
  } catch(e) {
    console.error('Error:', e.message);
    process.exit(1);
  }
}

main();
