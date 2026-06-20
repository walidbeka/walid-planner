import https from 'https';
import crypto from 'crypto';

const sa = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
const projectId = sa.project_id;
const toEmail = 'wmr77077@gmail.com';
const resendKey = process.env.RESEND_API_KEY;
const fb = 'https://firestore.googleapis.com/v1/projects/' + projectId + '/databases/(default)';

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
        try { const j = JSON.parse(data); if (res.statusCode >= 400) reject({ status: res.statusCode, body: j }); else resolve(j); }
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
    scope: 'https://www.googleapis.com/auth/datastore https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600, iat: now
  })).toString('base64url');
  const s = crypto.createSign('SHA256'); s.write(h + '.' + p); s.end();
  const a = h + '.' + p + '.' + s.sign(sa.private_key, 'base64url');
  return api('POST', 'https://oauth2.googleapis.com/token', null,
    'grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=' + encodeURIComponent(a),
    'application/x-www-form-urlencoded').then(r => r.access_token);
}

function priorityLabel(p) {
  const m = { high: 'عالية', medium: 'متوسطة', low: 'منخفضة' };
  return m[p] || p;
}
function priorityColor(p) {
  const m = { high: '#ef4444', medium: '#f59e0b', low: '#22c55e' };
  return m[p] || '#888';
}
function typeLabel(t) {
  const m = { work: 'عمل', personal: 'شخصي' };
  return m[t] || t;
}
function statusLabel(s) {
  const m = { new: 'جديدة', 'in-progress': 'قيد التنفيذ' };
  return m[s] || s;
}

function buildHtml(todayTasks, overdueTasks) {
  const now = new Date();
  const dateStr = now.toLocaleDateString('ar-EG', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

  let todayRows = '';
  if (todayTasks.length) {
    todayTasks.forEach((t, i) => {
      todayRows += `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333;">${i + 1}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333;font-weight:600;">${t.name}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            <span style="background:${priorityColor(t.priority)}22;color:${priorityColor(t.priority)};padding:3px 10px;border-radius:20px;font-weight:600;">${priorityLabel(t.priority)}</span>
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            <span style="background:#6366f122;color:#6366f1;padding:3px 10px;border-radius:20px;">${typeLabel(t.type)}</span>
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;">${t.project || '—'}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;">${t.time || '—'}</td>
        </tr>`;
    });
  }

  let overdueRows = '';
  if (overdueTasks.length) {
    overdueTasks.forEach((t, i) => {
      overdueRows += `
        <tr>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333;">${i + 1}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:15px;color:#333;font-weight:600;">${t.name}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;">
            <span style="background:${priorityColor(t.priority)}22;color:${priorityColor(t.priority)};padding:3px 10px;border-radius:20px;font-weight:600;">${priorityLabel(t.priority)}</span>
          </td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#dc2626;font-weight:600;">${t.date}</td>
          <td style="padding:12px 16px;border-bottom:1px solid #f0f0f0;font-size:13px;color:#666;">${t.project || '—'}</td>
        </tr>`;
    });
  }

  return `<!DOCTYPE html>
<html dir="rtl" lang="ar">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0"></head>
<body style="margin:0;padding:0;background:#f4f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;">
<div style="max-width:680px;margin:0 auto;padding:24px;">

  <div style="background:linear-gradient(135deg,#1a1a2e,#16213e);border-radius:16px 16px 0 0;padding:32px 24px;text-align:center;">
    <div style="font-size:36px;margin-bottom:8px;">📋</div>
    <h1 style="color:#fff;margin:0;font-size:22px;">Walid Planner — تذكير يومي</h1>
    <p style="color:#a0aec0;margin:8px 0 0;font-size:14px;">${dateStr}</p>
  </div>

  ${todayTasks.length ? `
  <div style="background:#fff;padding:24px;border-bottom:1px solid #eee;">
    <h2 style="margin:0 0 16px;font-size:18px;color:#1a1a2e;">📅 مهام اليوم <span style="background:#3b82f6;color:#fff;padding:2px 10px;border-radius:20px;font-size:13px;">${todayTasks.length}</span></h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#f8fafc;">
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;width:40px;">#</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">المهمة</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">الأولوية</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">النوع</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">المشروع</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">الوقت</th>
        </tr>
      </thead>
      <tbody>${todayRows}</tbody>
    </table>
  </div>` : ''}

  ${overdueTasks.length ? `
  <div style="background:#fff;padding:24px;border-bottom:1px solid #eee;">
    <h2 style="margin:0 0 16px;font-size:18px;color:#dc2626;">🔴 مهام متأخرة <span style="background:#dc2626;color:#fff;padding:2px 10px;border-radius:20px;font-size:13px;">${overdueTasks.length}</span></h2>
    <table style="width:100%;border-collapse:collapse;border:1px solid #eee;border-radius:8px;overflow:hidden;">
      <thead>
        <tr style="background:#fef2f2;">
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;width:40px;">#</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">المهمة</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">الأولوية</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">الموعد</th>
          <th style="padding:10px 16px;text-align:right;font-size:12px;color:#888;font-weight:600;">المشروع</th>
        </tr>
      </thead>
      <tbody>${overdueRows}</tbody>
    </table>
  </div>` : ''}

  <div style="background:#fff;border-radius:0 0 16px 16px;padding:20px 24px;text-align:center;border-top:1px solid #eee;">
    <p style="margin:0;color:#888;font-size:13px;">أرسل تلقائياً من <strong>Walid Planner</strong> ⚡</p>
  </div>

</div>
</body></html>`;
}

async function main() {
  try {
    const token = await getToken();
    const today = new Date();
    const todayStr = today.getFullYear() + '-' + String(today.getMonth() + 1).padStart(2, '0') + '-' + String(today.getDate()).padStart(2, '0');
    console.log('Date:', todayStr);

    let usersRes;
    try {
      usersRes = await api('GET', fb + '/documents/users', token);
    } catch(e) {
      console.log('Error reading users:', e.body?.error?.message || e.text);
      usersRes = {};
    }
    const uids = (usersRes.documents || []).map(d => d.name.split('/').pop());
    console.log('Found UIDs:', uids);

    if (uids.length === 0) { console.log('No users found'); return; }

    const allTasks = [];
    for (const uid of uids) {
      let page = '';
      while (true) {
        let url = fb + '/documents/users/' + uid + '/tasks?pageSize=500';
        if (page) url += '&pageToken=' + encodeURIComponent(page);
        const resp = await api('GET', url, token);
        for (const doc of (resp.documents || [])) {
          const f = doc.fields || {};
          allTasks.push({
            name: f.name?.stringValue || '',
            date: f.date?.stringValue || '',
            time: f.time?.stringValue || '',
            status: f.status?.stringValue || '',
            priority: f.priority?.stringValue || 'medium',
            type: f.type?.stringValue || 'work',
            project: f.project?.stringValue || '',
            archived: f.archived?.booleanValue || false
          });
        }
        page = resp.nextPageToken || '';
        if (!page) break;
      }
    }
    console.log('Total tasks:', allTasks.length);
    if (allTasks.length === 0) { console.log('No tasks'); return; }

    const todayTasks = allTasks.filter(t => t.date === todayStr && t.status !== 'completed' && !t.archived);
    const overdueTasks = allTasks.filter(t => t.date < todayStr && t.status !== 'completed' && !t.archived);
    console.log('Today:', todayTasks.length, 'Overdue:', overdueTasks.length);

    if (todayTasks.length === 0 && overdueTasks.length === 0) { console.log('No pending tasks'); return; }

    const html = buildHtml(todayTasks, overdueTasks);
    const subject = '📋 Walid Planner — مهام النهارده (' + todayTasks.length + ')' + (overdueTasks.length ? ' + متأخرة (' + overdueTasks.length + ')' : '');

    const payload = JSON.stringify({
      from: 'Walid Planner <onboarding@resend.dev>',
      to: [toEmail],
      subject: subject,
      html: html
    });

    const emailRes = await api('POST', 'https://api.resend.com/emails', resendKey, payload);
    console.log('✅ Email sent! ID:', emailRes.id);
  } catch(e) {
    console.error('Error:', e.body?.error?.message || e.text || JSON.stringify(e).slice(0, 300));
    process.exit(1);
  }
}

main();
