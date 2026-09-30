import { STORAGE_KEY, SHEET_NAME, SHEET_HEADER, emptyState, validateState, deriveItems, addInterval, uniqueEvents, eventToRow, rowToEvent } from './model.js';

const $ = selector => document.querySelector(selector);
const dateFormat = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
let state;
let accessToken = '';
let syncBusy = false;
let syncError = '';
let editingItemId = null;
let recordingItemId = null;
let recordType = 'use';

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  state = saved ? validateState(JSON.parse(saved)) : emptyState();
} catch {
  state = emptyState();
  alert('無法讀取手機副本。請先不要建立新紀錄，並檢查瀏覽器網站資料。');
}

function save() {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return true; }
  catch { alert('手機副本儲存失敗，這次操作未完成。請檢查裝置空間。'); return false; }
}

function node(tag, className = '', value) {
  const el = document.createElement(tag);
  el.className = className;
  if (value !== undefined) el.textContent = value;
  return el;
}

function localInputValue(date = new Date()) {
  const pad = n => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function toIso(input) {
  const date = new Date(input);
  if (!input || Number.isNaN(date.getTime())) throw new Error('請填寫有效的日期與時間。');
  return date.toISOString();
}

function intervalText(item) {
  const unit = { months: '個月', weeks: '週', days: '天' }[item.intervalUnit];
  return `每 ${item.intervalValue} ${unit}更換一次`;
}

function allEvents() { return uniqueEvents([...state.cloudEvents, ...state.pending]); }

function renderSync() {
  let message;
  if (!state.clientId) message = `尚未設定 Google 連結；目前只顯示手機副本${state.pending.length ? `，${state.pending.length} 筆待同步` : ''}。`;
  else if (syncBusy) message = '正在與 Google 試算表同步…';
  else if (syncError) message = `${syncError}；手機還有 ${state.pending.length} 筆待同步。`;
  else if (!accessToken) message = `尚未連結 Google；顯示手機副本${state.pending.length ? `，${state.pending.length} 筆待同步` : ''}。`;
  else if (state.pending.length) message = `${state.pending.length} 筆待同步，請按「重新同步」。`;
  else message = '已與私人 Google 試算表同步。';
  $('#syncStatus').textContent = message;
  $('#connectButton').textContent = accessToken ? '重新同步' : '連結 Google';
  $('#connectButton').disabled = syncBusy;
  $('#sheetLink').classList.toggle('hidden', !state.sheetId);
  if (state.sheetId) $('#sheetLink').href = `https://docs.google.com/spreadsheets/d/${encodeURIComponent(state.sheetId)}/edit`;
}

function renderItems() {
  const items = deriveItems(allEvents());
  const list = $('#itemList');
  list.replaceChildren();
  $('#itemCount').textContent = `${items.length} 項`;
  if (!items.length) list.append(node('div', 'empty', '沒有使用中的項目。請到「管理項目」新增。'));
  for (const item of items) {
    const card = node('article', 'item-card');
    const top = node('div', 'item-top');
    const title = node('div');
    title.append(node('h3', '', item.name), node('div', 'interval-label', intervalText(item)));
    const due = item.usedAt ? addInterval(item.usedAt, item.intervalValue, item.intervalUnit) : null;
    const daysLeft = due ? Math.ceil((due.getTime() - Date.now()) / 86400000) : null;
    const badge = node('span', `badge${due && daysLeft <= 0 ? ' due' : !due ? ' empty-badge' : ''}`,
      !due ? '尚未開始' : daysLeft < 0 ? `逾期 ${-daysLeft} 天` : daysLeft === 0 ? '今天到期' : `還有 ${daysLeft} 天`);
    top.append(title, badge);
    const dates = node('div', 'dates');
    const useCell = node('div', 'date-cell');
    useCell.append(node('small', '', '開始使用'), node('strong', '', item.usedAt ? dateFormat.format(new Date(item.usedAt)) : '尚未記錄'));
    const replaceCell = node('div', 'date-cell');
    replaceCell.append(node('small', '', '上次更換'), node('strong', '', item.replacedAt ? dateFormat.format(new Date(item.replacedAt)) : '尚未記錄'));
    dates.append(useCell, replaceCell);
    const next = node('div', 'due-date', due ? `下次預計更換：${dateFormat.format(due)}` : '記錄開始使用日期後，會顯示預計更換日。');
    const actions = node('div', 'card-actions');
    const useButton = node('button', 'secondary-button', item.usedAt ? '更正使用日期' : '記錄開始使用');
    useButton.type = 'button';
    useButton.addEventListener('click', () => openRecord(item.id, 'use'));
    const replaceButton = node('button', 'primary-button', '記錄更換');
    replaceButton.type = 'button';
    replaceButton.addEventListener('click', () => openRecord(item.id, 'replace'));
    actions.append(useButton, replaceButton);
    card.append(top, dates, next, actions);
    list.append(card);
  }
}

function renderHistory() {
  const events = allEvents().filter(event => event.type === 'use' || event.type === 'replace').reverse().slice(0, 30);
  const list = $('#historyList');
  list.replaceChildren();
  if (!events.length) { list.append(node('div', 'empty', '還沒有使用或更換紀錄。')); return; }
  const names = new Map(deriveItems(allEvents()).map(item => [item.id, item.name]));
  for (const event of events) {
    const row = node('div', 'history-row');
    const left = node('div');
    left.append(node('strong', '', `${names.get(event.itemId) || '已封存項目'} · ${event.type === 'replace' ? '已更換' : '開始使用'}`));
    if (event.type === 'replace') left.append(node('span', '', `新用品開始使用：${dateFormat.format(new Date(event.payload.usedAt))}`));
    row.append(left, node('time', '', dateFormat.format(new Date(event.type === 'replace' ? event.payload.replacedAt : event.payload.usedAt))));
    list.append(row);
  }
}

function renderSettings() {
  const list = $('#settingsItems');
  list.replaceChildren();
  for (const item of deriveItems(allEvents())) {
    const row = node('div', 'settings-row');
    const info = node('div');
    info.append(node('strong', '', item.name), node('span', '', intervalText(item)));
    const edit = node('button', '', '編輯');
    edit.type = 'button';
    edit.addEventListener('click', () => openItem(item.id));
    row.append(info, edit);
    list.append(row);
  }
}

function render() { renderSync(); renderItems(); renderHistory(); renderSettings(); }

function addEvent(type, itemId, payload) {
  const event = { id: crypto.randomUUID(), createdAt: new Date().toISOString(), type, itemId, payload };
  state.pending.push(event);
  if (!save()) { state.pending.pop(); return false; }
  syncError = '';
  render();
  if (accessToken) syncCloud();
  return true;
}

function openRecord(itemId, type) {
  recordingItemId = itemId;
  recordType = type;
  const item = deriveItems(allEvents()).find(row => row.id === itemId);
  $('#recordForm').reset();
  $('#recordError').textContent = '';
  $('#recordTitle').textContent = `${type === 'replace' ? '記錄更換' : '記錄使用'} · ${item.name}`;
  $('#recordEyebrow').textContent = type === 'replace' ? '實際更換時間' : '開始使用時間';
  $('#replacementField').classList.toggle('hidden', type !== 'replace');
  $('#replacedAt').required = type === 'replace';
  $('#replacedAt').value = localInputValue();
  $('#replacedAt').dataset.previous = $('#replacedAt').value;
  $('#usedAt').value = type === 'use' && item.usedAt ? localInputValue(new Date(item.usedAt)) : localInputValue();
  $('#recordHint').textContent = type === 'replace'
    ? '更換後若立刻開始使用新用品，兩個時間保持相同即可。'
    : '再次儲存使用日期會更新目前週期；先前紀錄仍保留。';
  $('#recordDialog').showModal();
}

function openItem(itemId = null) {
  editingItemId = itemId;
  const item = deriveItems(allEvents()).find(row => row.id === itemId);
  $('#itemForm').reset();
  $('#itemError').textContent = '';
  $('#itemDialogTitle').textContent = item ? '編輯項目' : '新增項目';
  $('#itemName').value = item?.name ?? '';
  $('#intervalValue').value = item?.intervalValue ?? 1;
  $('#intervalUnit').value = item?.intervalUnit ?? 'months';
  $('#archiveItem').classList.toggle('hidden', !item);
  $('#itemDialog').showModal();
}

function parseSheetId(input) {
  const value = input.trim();
  if (!value) return '';
  const match = value.match(/\/spreadsheets\/d\/([\w-]+)/);
  const id = match ? match[1] : value;
  if (!/^[\w-]{20,}$/.test(id)) throw new Error('請填入有效的 Google 試算表網址或 ID。');
  return id;
}

function googleReady() { return Boolean(window.google?.accounts?.oauth2); }

async function getToken() {
  if (!googleReady()) throw new Error('Google 登入元件尚未載入。請確認網路後重試。');
  return new Promise((resolve, reject) => {
    const client = google.accounts.oauth2.initTokenClient({
      client_id: state.clientId,
      scope: SCOPE,
      callback: response => response?.access_token ? resolve(response.access_token) : reject(new Error(response?.error || 'Google 授權未完成')),
      error_callback: error => reject(new Error(error?.message || error?.type || 'Google 登入視窗未完成'))
    });
    client.requestAccessToken();
  });
}

async function apiRequest(path, { method = 'GET', body } = {}) {
  const response = await fetch(`${API}${path}`, {
    method,
    headers: { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
    body: body ? JSON.stringify(body) : undefined
  });
  if (!response.ok) {
    if (response.status === 401) accessToken = '';
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch { /* Keep status. */ }
    throw new Error(response.status === 401 ? 'Google 授權已過期，請再次連結' : `Google 試算表回應 ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return response.json();
}

function rangePath(range) {
  return `/${encodeURIComponent(state.sheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!${range}`)}`;
}

async function createSheet() {
  const result = await apiRequest('', { method: 'POST', body: {
    properties: { title: '更換小記｜貓砂與隱形眼鏡' },
    sheets: [{ properties: { title: SHEET_NAME, gridProperties: { frozenRowCount: 1 } } }]
  } });
  state.sheetId = result.spreadsheetId;
  if (!save()) throw new Error('試算表已建立，但無法將網址存到手機。請立即從 Google 雲端硬碟找回「更換小記」試算表。');
  await apiRequest(`${rangePath('A1:E1')}?valueInputOption=RAW`, { method: 'PUT', body: { values: [SHEET_HEADER] } });
}

async function readCloud() {
  const result = await apiRequest(rangePath('A1:E'));
  const rows = result.values || [];
  if (!rows.length) {
    await apiRequest(`${rangePath('A1:E1')}?valueInputOption=RAW`, { method: 'PUT', body: { values: [SHEET_HEADER] } });
    return [];
  }
  if (JSON.stringify(rows[0]) !== JSON.stringify(SHEET_HEADER)) throw new Error('此試算表不是「更換小記」建立的格式，請填入原本的試算表。');
  return rows.slice(1).filter(row => row.some(cell => cell !== '')).map((row, index) => {
    try { return rowToEvent(row); }
    catch { throw new Error(`試算表第 ${index + 2} 列格式不正確，請檢查後重試。`); }
  });
}

async function appendCloud(event) {
  await apiRequest(`${rangePath('A:E')}:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS`, {
    method: 'POST', body: { values: [eventToRow(event)] }
  });
}

async function syncCloud() {
  if (syncBusy || !accessToken) return;
  syncBusy = true;
  syncError = '';
  renderSync();
  try {
    if (!state.sheetId) await createSheet();
    let remote = await readCloud();
    const remoteIds = new Set(remote.map(event => event.id));
    state.cloudEvents = uniqueEvents(remote);
    state.pending = state.pending.filter(event => !remoteIds.has(event.id));
    if (!save()) throw new Error('手機副本儲存失敗，請勿繼續操作。');
    while (state.pending.length) {
      const event = state.pending[0];
      await appendCloud(event);
      state.cloudEvents.push(event);
      state.pending.shift();
      if (!save()) throw new Error('試算表已收到紀錄，但手機副本更新失敗。請重新載入再同步。');
    }
    remote = await readCloud();
    state.cloudEvents = uniqueEvents(remote);
    if (!save()) throw new Error('手機副本更新失敗。');
  } catch (error) {
    syncError = error.message || '同步失敗';
  } finally {
    syncBusy = false;
    render();
  }
}

$('#settingsButton').addEventListener('click', () => $('#itemsDialog').showModal());
$('#closeItems').addEventListener('click', () => $('#itemsDialog').close());
$('#addItem').addEventListener('click', () => openItem());
$('#closeItem').addEventListener('click', () => $('#itemDialog').close());
$('#closeRecord').addEventListener('click', () => $('#recordDialog').close());
$('#cloudSettingsButton').addEventListener('click', () => {
  $('#cloudError').textContent = '';
  $('#clientId').value = state.clientId;
  $('#sheetId').value = state.sheetId;
  renderSync();
  $('#cloudDialog').showModal();
});
$('#closeCloud').addEventListener('click', () => $('#cloudDialog').close());

$('#recordForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const usedAt = toIso($('#usedAt').value);
    const payload = recordType === 'replace' ? { replacedAt: toIso($('#replacedAt').value), usedAt } : { usedAt };
    if (recordType === 'replace' && new Date(usedAt) < new Date(payload.replacedAt)) throw new Error('開始使用時間不可早於更換時間。');
    if (addEvent(recordType, recordingItemId, payload)) $('#recordDialog').close();
  } catch (error) { $('#recordError').textContent = error.message; }
});

$('#replacedAt').addEventListener('change', () => {
  if ($('#usedAt').value === $('#replacedAt').dataset.previous) $('#usedAt').value = $('#replacedAt').value;
  $('#replacedAt').dataset.previous = $('#replacedAt').value;
});

$('#itemForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#itemName').value.trim();
  const intervalValue = Number($('#intervalValue').value);
  if (!name || !Number.isInteger(intervalValue) || intervalValue < 1 || intervalValue > 365) {
    $('#itemError').textContent = '請輸入名稱，以及 1 至 365 的更換間隔。';
    return;
  }
  const id = editingItemId || crypto.randomUUID();
  if (addEvent('config', id, { name, intervalValue, intervalUnit: $('#intervalUnit').value, active: true })) $('#itemDialog').close();
});

$('#archiveItem').addEventListener('click', () => {
  const item = deriveItems(allEvents()).find(row => row.id === editingItemId);
  if (!item || !confirm(`封存「${item.name}」？過去的使用與更換紀錄會保留。`)) return;
  if (addEvent('config', item.id, { name: item.name, intervalValue: item.intervalValue, intervalUnit: item.intervalUnit, active: false })) $('#itemDialog').close();
});

$('#cloudForm').addEventListener('submit', event => {
  event.preventDefault();
  try {
    const clientId = $('#clientId').value.trim();
    if (!/^[\w.-]+\.apps\.googleusercontent\.com$/.test(clientId)) throw new Error('請填入有效的 OAuth 網頁用戶端 ID。');
    const sheetId = parseSheetId($('#sheetId').value);
    if (sheetId !== state.sheetId && state.pending.length && state.sheetId) throw new Error('目前仍有待同步紀錄，請先同步完成再更換試算表。');
    const previous = structuredClone(state);
    state.clientId = clientId;
    if (sheetId !== state.sheetId) { state.sheetId = sheetId; state.cloudEvents = []; accessToken = ''; }
    if (clientId !== previous.clientId) accessToken = '';
    if (!save()) { state = previous; return; }
    syncError = '';
    $('#cloudDialog').close();
    render();
  } catch (error) { $('#cloudError').textContent = error.message; }
});

$('#connectButton').addEventListener('click', async () => {
  if (!state.clientId) { $('#cloudSettingsButton').click(); return; }
  try {
    if (!accessToken) accessToken = await getToken();
    await syncCloud();
  } catch (error) { syncError = error.message || '連結失敗'; renderSync(); }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();
