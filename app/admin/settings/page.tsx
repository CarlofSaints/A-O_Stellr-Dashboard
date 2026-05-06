'use client';

import { useState, useEffect } from 'react';
import { useRouter } from 'next/navigation';

interface Session {
  id: string;
  name: string;
  email: string;
  isAdmin: boolean;
}

interface PollSlot {
  id: string;
  time: string;
  type: 'short' | 'long';
  enabled: boolean;
}

interface PollSchedule {
  slots: PollSlot[];
  timezone: string;
}

interface PerigeeConfig {
  apiKey: string;
  endpoint: string;
  enabled: boolean;
  lastPolledAt: string | null;
  requestBody?: string;
}

interface CronLogEntry {
  timestamp: string;
  matched: boolean;
  slotTime?: string;
  slotType?: string;
  result?: string;
  imported?: number;
  skipped?: number;
  error?: string;
}

interface TestResult {
  ok?: boolean;
  error?: string;
  detail?: string;
  totalRows?: number;
  responseKeys?: string[];
  sample?: Record<string, unknown>[];
  rawTopLevelKeys?: string[];
  meta?: Record<string, unknown>;
  sentBody?: Record<string, unknown>;
}

const DEFAULT_BODY = JSON.stringify({
  startDate: new Date().toISOString().slice(0, 10),
  endDate: '',
  channels: [],
  stores: [],
  provinces: [],
  users: [],
  tags: [],
  customers: [],
  userStatus: ['ACTIVE', 'INACTIVE'],
  userAccess: ['ENABLED', 'SUSPENDED'],
  includeDataUsage: 'YES',
  includeNotificationData: 'NO',
  includeTravelDistance: 'YES',
  includeRecessData: 'NO',
  earlyCheckoutTime: '16:50',
  lateCheckinTime: '09:10',
}, null, 2);

function authFetch(url: string, init: RequestInit = {}): Promise<Response> {
  let userId = '';
  try {
    const raw = localStorage.getItem('ao_session');
    if (raw) userId = JSON.parse(raw).id ?? '';
  } catch { /* ignore */ }
  const headers = new Headers(init.headers);
  if (userId) headers.set('x-user-id', userId);
  return fetch(url, { ...init, headers });
}

export default function AdminSettingsPage() {
  const [session, setSession] = useState<Session | null>(null);
  const router = useRouter();

  const [config, setConfig] = useState<PerigeeConfig | null>(null);
  const [form, setForm] = useState({ apiKey: '', endpoint: '', enabled: false });
  const [requestBody, setRequestBody] = useState(DEFAULT_BODY);
  const [bodyError, setBodyError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [testResult, setTestResult] = useState<TestResult | null>(null);
  const [toast, setToast] = useState('');

  const [schedule, setSchedule] = useState<PollSchedule>({ slots: [], timezone: 'Africa/Johannesburg' });
  const [savingSchedule, setSavingSchedule] = useState(false);
  const [cronLogs, setCronLogs] = useState<CronLogEntry[]>([]);
  const [loadingLogs, setLoadingLogs] = useState(false);
  const [testingCron, setTestingCron] = useState(false);

  // Auth check
  useEffect(() => {
    const raw = localStorage.getItem('ao_session');
    if (!raw) { router.replace('/login'); return; }
    const s: Session = JSON.parse(raw);
    if (!s.isAdmin) { router.replace('/'); return; }
    setSession(s);
  }, [router]);

  // Load config
  useEffect(() => {
    if (!session) return;
    authFetch('/api/config/perigee')
      .then(r => r.json())
      .then(data => {
        setConfig(data);
        setForm({ apiKey: '', endpoint: data.endpoint || '', enabled: data.enabled || false });
        if (data.requestBody) setRequestBody(data.requestBody);
      })
      .catch(() => {});
    authFetch('/api/config/perigee-schedule')
      .then(r => r.json())
      .then(data => { if (data.slots) setSchedule(data); })
      .catch(() => {});
    loadCronLogs();
  }, [session]);

  function loadCronLogs() {
    setLoadingLogs(true);
    authFetch('/api/cron/logs')
      .then(r => r.json())
      .then(data => { if (data.logs) setCronLogs(data.logs); })
      .catch(() => {})
      .finally(() => setLoadingLogs(false));
  }

  async function testCronNow() {
    setTestingCron(true);
    try {
      const res = await authFetch('/api/cron/poll-visits?force=true');
      const data = await res.json();
      showToast(
        data.ok
          ? `Cron test: ${data.action} — imported: ${data.imported ?? 0}, skipped: ${data.skipped ?? 0}${data.reason ? ` (${data.reason})` : ''}`
          : `Cron error: ${data.error || 'Unknown'}`
      );
      loadCronLogs();
    } catch {
      showToast('Failed to trigger cron');
    } finally {
      setTestingCron(false);
    }
  }

  function showToast(msg: string) {
    setToast(msg);
    setTimeout(() => setToast(''), 3500);
  }

  function handleBodyChange(val: string) {
    setRequestBody(val);
    try {
      JSON.parse(val);
      setBodyError('');
    } catch (e) {
      setBodyError(e instanceof Error ? e.message : 'Invalid JSON');
    }
  }

  async function handleSave() {
    setSaving(true);
    try {
      try { JSON.parse(requestBody); } catch {
        showToast('Fix the JSON errors before saving');
        setSaving(false);
        return;
      }

      const body: Record<string, unknown> = {
        endpoint: form.endpoint,
        enabled: form.enabled,
        requestBody,
      };
      if (form.apiKey) body.apiKey = form.apiKey;

      const res = await authFetch('/api/config/perigee', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      if (res.ok) {
        showToast('Settings saved');
        setForm(f => ({ ...f, apiKey: '' }));
        const r2 = await authFetch('/api/config/perigee');
        setConfig(await r2.json());
      } else {
        showToast('Save failed');
      }
    } catch {
      showToast('Save failed');
    } finally {
      setSaving(false);
    }
  }

  async function callPoll(mode: 'test' | 'import') {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(requestBody);
    } catch {
      showToast('Fix the JSON errors first');
      return;
    }

    if (!parsed.startDate) {
      showToast('startDate is required in the request body');
      return;
    }

    if (mode === 'test') {
      setTesting(true);
      setTestResult(null);
    } else {
      if (!confirm(`Import visits from ${parsed.startDate}? This will fetch data from Perigee.`)) return;
      setImporting(true);
    }

    try {
      const res = await authFetch('/api/perigee/poll', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...parsed, mode }),
      });
      const data = await res.json();

      if (mode === 'test') {
        setTestResult(data);
        showToast(data.ok ? `Test OK \u2014 ${data.totalRows} visits returned` : (data.error || 'Test failed'));
      } else {
        showToast(data.ok ? `${data.totalRows} visits returned` : (data.error || 'Import failed'));
      }
    } catch {
      showToast(`${mode === 'test' ? 'Connection' : 'Import'} failed`);
    } finally {
      setTesting(false);
      setImporting(false);
    }
  }

  function addPollSlot() {
    setSchedule(s => ({
      ...s,
      slots: [...s.slots, { id: crypto.randomUUID(), time: '08:00', type: 'short', enabled: true }],
    }));
  }

  function updateSlot(id: string, field: keyof PollSlot, value: string | boolean) {
    setSchedule(s => ({
      ...s,
      slots: s.slots.map(sl => sl.id === id ? { ...sl, [field]: value } : sl),
    }));
  }

  function removeSlot(id: string) {
    setSchedule(s => ({ ...s, slots: s.slots.filter(sl => sl.id !== id) }));
  }

  async function saveSchedule() {
    setSavingSchedule(true);
    try {
      const res = await authFetch('/api/config/perigee-schedule', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(schedule),
      });
      showToast(res.ok ? 'Poll schedule saved' : 'Failed to save schedule');
    } catch {
      showToast('Failed to save schedule');
    } finally {
      setSavingSchedule(false);
    }
  }

  if (!session) return null;

  const INPUT = 'w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:border-[#1B3A6B]';
  const BTN_PRIMARY = 'bg-[#1B3A6B] text-white px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#152f5a] transition-colors disabled:opacity-60';
  const BTN_OUTLINE = 'border border-[#1B3A6B] text-[#1B3A6B] px-5 py-2 rounded-lg text-sm font-semibold hover:bg-[#1B3A6B]/5 transition-colors disabled:opacity-60';

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-[#1B3A6B] text-white px-6 py-4 shadow-md">
        <div className="max-w-3xl mx-auto flex items-center justify-between">
          <div>
            <h1 className="text-base font-bold">API Settings</h1>
            <p className="text-blue-200 text-xs">Perigee API Configuration</p>
          </div>
          <button onClick={() => router.push('/')} className="text-blue-200 hover:text-white text-sm flex items-center gap-1.5 transition-colors">
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Dashboard
          </button>
        </div>
      </header>

      <main className="max-w-3xl mx-auto px-6 py-8 space-y-6">

        {/* Perigee API Connection */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Perigee API Connection</h2>
          <p className="text-xs text-gray-500 mb-4">Endpoint and authentication for the Perigee visit data API</p>

          <div className="space-y-3">
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">API Endpoint</label>
              <input
                className={INPUT}
                value={form.endpoint}
                onChange={e => setForm({ ...form, endpoint: e.target.value })}
                placeholder="https://live.perigeeportal.co.za/api/visits"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-gray-600 mb-1">
                Bearer Token {config?.apiKey && <span className="text-gray-400 font-normal">(current: {config.apiKey})</span>}
              </label>
              <input
                className={INPUT}
                type="password"
                value={form.apiKey}
                onChange={e => setForm({ ...form, apiKey: e.target.value })}
                placeholder="Leave blank to keep current token"
              />
            </div>
            {config?.lastPolledAt && (
              <p className="text-xs text-gray-500">
                Last polled: {new Date(config.lastPolledAt).toLocaleString('en-ZA')}
              </p>
            )}
            <button className={BTN_PRIMARY} onClick={handleSave} disabled={saving}>
              {saving ? 'Saving...' : 'Save Settings'}
            </button>
          </div>
        </div>

        {/* Request Body + Test/Import */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Request Body</h2>
          <p className="text-xs text-gray-500 mb-4">JSON body sent to Perigee &mdash; edit filters, dates, and options below</p>

          <textarea
            className={INPUT + ' font-mono text-xs leading-relaxed'}
            value={requestBody}
            onChange={e => handleBodyChange(e.target.value)}
            rows={18}
            style={{ resize: 'vertical' }}
            spellCheck={false}
          />
          {bodyError && (
            <p className="text-red-600 text-xs mt-1">{bodyError}</p>
          )}

          <div className="flex gap-3 mt-4">
            <button className={BTN_OUTLINE} onClick={() => callPoll('test')} disabled={testing || !!bodyError}>
              {testing ? 'Testing...' : 'Test Connection'}
            </button>
            <button className={BTN_PRIMARY} onClick={() => callPoll('import')} disabled={importing || !!bodyError}>
              {importing ? 'Importing...' : 'Import Visits'}
            </button>
          </div>

          {/* Test Results */}
          {testResult && (
            <div className={`mt-4 p-4 rounded-lg text-sm border ${testResult.ok ? 'bg-green-50 border-green-200' : 'bg-red-50 border-red-200'}`}>
              {testResult.ok ? (
                <>
                  <p className="font-semibold text-green-800 mb-1">
                    Connection successful &mdash; {testResult.totalRows} visits returned
                  </p>
                  {testResult.responseKeys && testResult.responseKeys.length > 0 && (
                    <p className="text-gray-700 text-xs mb-2">
                      <strong>Fields:</strong> {testResult.responseKeys.join(', ')}
                    </p>
                  )}
                  {testResult.meta && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-gray-600 text-xs">Perigee response metadata</summary>
                      <pre className="mt-1 overflow-auto max-h-48 text-[11px] bg-gray-50 p-2 rounded">
                        {JSON.stringify(testResult.meta, null, 2)}
                      </pre>
                    </details>
                  )}
                  {testResult.sentBody && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-gray-600 text-xs">Request body sent</summary>
                      <pre className="mt-1 overflow-auto max-h-48 text-[11px] bg-gray-50 p-2 rounded">
                        {JSON.stringify(testResult.sentBody, null, 2)}
                      </pre>
                    </details>
                  )}
                  {testResult.sample && testResult.sample.length > 0 && (
                    <details className="mt-2">
                      <summary className="cursor-pointer text-gray-600 text-xs">Sample data ({testResult.sample.length} rows)</summary>
                      <pre className="mt-1 overflow-auto max-h-48 text-[11px] bg-gray-50 p-2 rounded">
                        {JSON.stringify(testResult.sample, null, 2)}
                      </pre>
                    </details>
                  )}
                </>
              ) : (
                <>
                  <p className="font-semibold text-red-800 mb-1">{testResult.error}</p>
                  {testResult.detail && (
                    <pre className="overflow-auto max-h-36 text-xs text-gray-600">{testResult.detail}</pre>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Polling Schedule */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <h2 className="text-sm font-bold text-gray-700 mb-1">Polling Schedule</h2>
          <p className="text-xs text-gray-500 mb-4">
            Configure automated polling times (SAST). Cron runs every 30 minutes and fires on matching slots.
          </p>

          {schedule.slots.length === 0 ? (
            <p className="text-gray-400 text-xs italic mb-3">No poll slots configured.</p>
          ) : (
            <div className="space-y-2 mb-4">
              {schedule.slots.map(slot => (
                <div key={slot.id} className="flex items-center gap-3 p-3 bg-gray-50 rounded-lg border border-gray-100">
                  <input
                    type="time"
                    value={slot.time}
                    onChange={e => updateSlot(slot.id, 'time', e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                  />
                  <select
                    value={slot.type}
                    onChange={e => updateSlot(slot.id, 'type', e.target.value)}
                    className="px-2 py-1.5 border border-gray-300 rounded text-sm"
                  >
                    <option value="short">Short (today only)</option>
                    <option value="long">Long (last 7 days)</option>
                  </select>
                  <label className="flex items-center gap-1.5 text-sm text-gray-700 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={slot.enabled}
                      onChange={e => updateSlot(slot.id, 'enabled', e.target.checked)}
                      className="w-4 h-4 accent-[#1B3A6B]"
                    />
                    Enabled
                  </label>
                  <button
                    onClick={() => removeSlot(slot.id)}
                    className="ml-auto text-red-400 hover:text-red-600 text-xs font-medium transition-colors"
                  >
                    Remove
                  </button>
                </div>
              ))}
            </div>
          )}

          <div className="flex gap-3">
            <button className={BTN_OUTLINE} onClick={addPollSlot}>+ Add Poll Slot</button>
            <button className={BTN_PRIMARY} onClick={saveSchedule} disabled={savingSchedule}>
              {savingSchedule ? 'Saving...' : 'Save Schedule'}
            </button>
          </div>
        </div>

        {/* Cron Activity Log */}
        <div className="bg-white rounded-xl border border-gray-200 shadow-sm p-6">
          <div className="flex justify-between items-start mb-4">
            <div>
              <h2 className="text-sm font-bold text-gray-700 mb-1">Cron Activity Log</h2>
              <p className="text-xs text-gray-500">Recent automated polling attempts</p>
            </div>
            <div className="flex gap-2">
              <button onClick={loadCronLogs} disabled={loadingLogs} className={BTN_OUTLINE + ' !px-3 !py-1.5 !text-xs'}>
                {loadingLogs ? 'Loading...' : 'Refresh'}
              </button>
              <button onClick={testCronNow} disabled={testingCron} className={BTN_PRIMARY + ' !px-3 !py-1.5 !text-xs'}>
                {testingCron ? 'Running...' : 'Test Cron Now'}
              </button>
            </div>
          </div>

          {cronLogs.length === 0 ? (
            <p className="text-gray-400 text-xs italic">
              {loadingLogs ? 'Loading logs...' : 'No cron activity recorded yet.'}
            </p>
          ) : (
            <div className="max-h-80 overflow-y-auto">
              <table className="w-full text-xs">
                <thead>
                  <tr className="border-b border-gray-200 text-gray-500 text-left">
                    <th className="py-1.5 px-2">Time (SAST)</th>
                    <th className="py-1.5 px-2">Matched</th>
                    <th className="py-1.5 px-2">Slot</th>
                    <th className="py-1.5 px-2">Result</th>
                  </tr>
                </thead>
                <tbody>
                  {cronLogs.map((log, i) => (
                    <tr
                      key={i}
                      className={`border-b border-gray-50 ${log.error ? 'bg-red-50' : log.imported && log.imported > 0 ? 'bg-green-50' : ''}`}
                    >
                      <td className="py-1.5 px-2 whitespace-nowrap">
                        {new Date(log.timestamp).toLocaleString('en-ZA', { timeZone: 'Africa/Johannesburg', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}
                      </td>
                      <td className="py-1.5 px-2">
                        <span className={`font-semibold ${log.matched ? 'text-green-600' : 'text-gray-400'}`}>
                          {log.matched ? 'Yes' : 'No'}
                        </span>
                      </td>
                      <td className="py-1.5 px-2">
                        {log.slotTime ? `${log.slotTime} (${log.slotType})` : '\u2014'}
                      </td>
                      <td className={`py-1.5 px-2 ${log.error ? 'text-red-600' : 'text-gray-700'}`}>
                        {log.error
                          ? log.error.slice(0, 60)
                          : log.imported !== undefined
                            ? `+${log.imported} imported, ${log.skipped ?? 0} skipped`
                            : log.result || '\u2014'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

      </main>

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-6 right-6 bg-gray-800 text-white text-sm px-4 py-3 rounded-lg shadow-lg z-50">
          {toast}
        </div>
      )}
    </div>
  );
}
