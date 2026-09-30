import { STORAGE_KEY, SHEET_NAME, SHEET_HEADER, emptyState, validateState, deriveItems, activeEvents, addInterval, uniqueEvents, eventToRow, rowToEvent } from './model.js?v=4';

const $ = selector => document.querySelector(selector);
const dateFormat = new Intl.DateTimeFormat('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
const API = 'https://sheets.googleapis.com/v4/spreadsheets';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';
const SHEET_TITLE = '更換小記｜貓砂與隱形眼鏡';
const SCOPE = 'https://www.googleapis.com/auth/drive.file';
const CLIENT_ID = '982138207228-4o8g32u2sqimdasrjcatu3h3j9qe766o.apps.googleusercontent.com';
let state;
let accessToken = '';
let syncBusy = false;
let syncError = '';
let editingItemId = null;
let editingRecordId = null;
let undoEvent = null;

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  state = saved ? validateState(JSON.parse(saved)) : emptyState();
} catch {
  state = emptyState();
  alert('無法讀取手機副本。請先不要建立新紀錄，並檢查瀏覽器網站資料。');
}
state.clientId = CLIENT_ID;

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

function localInputValue(iso) {
  const date = new Date(iso);
  const pad = value => String(value).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function intervalText(item) {
  const unit = { months: '個月', weeks: '週', days: '天' }[item.intervalUnit];
  return `每 ${item.intervalValue} ${unit}更換一次`;
}

function allEvents() { return uniqueEvents([...state.cloudEvents, ...state.pending]); }
function sheetUrl() { return `https://docs.google.com/spreadsheets/d/${encodeURIComponent(state.sheetId)}/edit`; }

function renderSync() {
  let message;
  if (syncBusy) message = '正在與 Google 試算表同步…';
  else if (syncError) message = `${syncError}${state.pending.length ? `；手機還有 ${state.pending.length} 筆待同步。` : ''}`;
  else if (!state.sheetId) message = `尚未指定試算表；請在「同步設定」貼入既有表網址，或首次使用時建立一份。${state.pending.length ? ` ${state.pending.length} 筆待同步。` : ''}`;
  else if (!accessToken) message = `尚未連結 Google；顯示手機副本${state.pending.length ? `，${state.pending.length} 筆待同步` : ''}。`;
  else if (state.pending.length) message = `${state.pending.length} 筆待同步，請按「重新同步」。`;
  else message = '已與私人 Google 試算表同步。';
  $('#syncStatus').textContent = message;
  $('#connectButton').textContent = accessToken ? '重新同步' : '連結 Google';
  $('#connectButton').disabled = syncBusy;
  $('#sheetLink').classList.toggle('hidden', !state.sheetId);
  $('#copySheetButton').classList.toggle('hidden', !state.sheetId);
  $('#createSheetButton').classList.toggle('hidden', Boolean(state.sheetId));
  if (state.sheetId) $('#sheetLink').href = sheetUrl();
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
    const dateCell = node('div', 'date-cell');
    dateCell.append(node('small', '', '本次更換／開始使用時間'));
    if (item.usedAt && item.recordId) {
      const editDate = node('button', 'record-time-button', `${dateFormat.format(new Date(item.usedAt))}　修改`);
      editDate.type = 'button';
      editDate.setAttribute('aria-label', `修改「${item.name}」本次更換時間`);
      editDate.addEventListener('click', () => openRecordEditor(item.recordId));
      dateCell.append(editDate);
    } else dateCell.append(node('strong', '', '尚未記錄'));
    dates.append(dateCell);
    const next = node('div', 'due-date', due ? `下次預計更換：${dateFormat.format(due)}` : '按「更換」記錄現在，開始計算下次日期。');
    const actions = node('div', 'card-actions');
    const replaceButton = node('button', 'primary-button', '更換');
    replaceButton.type = 'button';
    replaceButton.addEventListener('click', () => recordReplacement(item));
    actions.append(replaceButton);
    card.append(top, dates, next, actions);
    list.append(card);
  }
}

function renderHistory() {
  const events = activeEvents(allEvents()).filter(event => event.type === 'use' || event.type === 'replace').reverse().slice(0, 30);
  const list = $('#historyList');
  list.replaceChildren();
  if (!events.length) { list.append(node('div', 'empty', '還沒有更換紀錄。')); return; }
  const names = new Map(deriveItems(allEvents()).map(item => [item.id, item.name]));
  for (const event of events) {
    const row = node('div', 'history-row');
    const left = node('div');
    left.append(node('strong', '', `${names.get(event.itemId) || '已封存項目'} · ${event.type === 'replace' ? '已更換' : '開始使用'}`));
    const edit = node('button', 'history-edit', `${dateFormat.format(new Date(event.payload.usedAt))}　修改`);
    edit.type = 'button';
    edit.setAttribute('aria-label', `修改「${names.get(event.itemId) || '已封存項目'}」這筆時間`);
    edit.addEventListener('click', () => openRecordEditor(event.id));
    row.append(left, edit);
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
  if (!save()) { state.pending.pop(); return null; }
  syncError = '';
  render();
  if (accessToken) syncCloud();
  return event;
}

function recordReplacement(item) {
  const now = new Date().toISOString();
  const event = addEvent('replace', item.id, { replacedAt: now, usedAt: now });
  if (!event) return;
  undoEvent = event;
  $('#undoText').textContent = `已記錄「${item.name}」更換時間：${dateFormat.format(new Date(now))}`;
  $('#undoNotice').classList.remove('hidden');
}

function openRecordEditor(recordId) {
  const record = activeEvents(allEvents()).find(event => event.id === recordId && ['use', 'replace'].includes(event.type));
  if (!record) return;
  editingRecordId = record.id;
  const item = deriveItems(allEvents()).find(value => value.id === record.itemId);
  $('#editRecordTitle').textContent = `修改時間 · ${item?.name || '已封存項目'}`;
  $('#editRecordTime').value = localInputValue(record.payload.usedAt);
  $('#editRecordError').textContent = '';
  $('#editRecordDialog').showModal();
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
      client_id: CLIENT_ID,
      scope: SCOPE,
      callback: response => response?.access_token ? resolve(response.access_token) : reject(new Error(response?.error || 'Google 授權未完成')),
      error_callback: error => reject(new Error(error?.message || error?.type || 'Google 登入視窗未完成'))
    });
    client.requestAccessToken();
  });
}

async function apiRequest(path, { method = 'GET', body, base = API } = {}) {
  const url = `${base}${path}`;
  const headers = { Authorization: `Bearer ${accessToken}`, ...(body ? { 'Content-Type': 'application/json' } : {}) };
  const payload = body ? JSON.stringify(body) : undefined;
  let response;
  try { response = await fetch(url, { method, headers, body: payload }); }
  catch {
    response = await new Promise((resolve, reject) => {
      const request = new XMLHttpRequest();
      request.open(method, url);
      for (const [key, value] of Object.entries(headers)) request.setRequestHeader(key, value);
      request.onload = () => resolve({
        ok: request.status >= 200 && request.status < 300,
        status: request.status,
        json: async () => JSON.parse(request.responseText)
      });
      request.onerror = () => reject(new Error('無法連接 Google API，請檢查網路或改用 Safari／Chrome。'));
      request.send(payload);
    });
  }
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) accessToken = '';
    let detail = '';
    try { detail = (await response.json()).error?.message || ''; } catch { /* Keep status. */ }
    throw new Error(response.status === 401 ? 'Google 授權已過期，請再次連結' : `Google API 回應 ${response.status}${detail ? `：${detail}` : ''}`);
  }
  return response.json();
}

function rangePath(range) {
  return `/${encodeURIComponent(state.sheetId)}/values/${encodeURIComponent(`${SHEET_NAME}!${range}`)}`;
}

async function checkSheetLocation() {
  const file = await apiRequest(`/${encodeURIComponent(state.sheetId)}?fields=id,name,trashed`, { base: DRIVE_API });
  if (file.trashed) throw new Error('這份試算表在 Google 雲端硬碟的垃圾桶。請從「同步設定」開啟試算表並還原，再按「重新同步」。');
}

async function createSheet() {
  const result = await apiRequest('', { method: 'POST', body: {
    properties: { title: SHEET_TITLE },
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
    if (!state.sheetId) throw new Error('請先在「同步設定」貼入既有試算表網址，或明確選擇建立新表');
    await checkSheetLocation();
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
    if (!syncError && accessToken && state.pending.length) queueMicrotask(syncCloud);
  }
}

$('#settingsButton').addEventListener('click', () => $('#itemsDialog').showModal());
$('#closeItems').addEventListener('click', () => $('#itemsDialog').close());
$('#addItem').addEventListener('click', () => openItem());
$('#closeItem').addEventListener('click', () => $('#itemDialog').close());
$('#closeEditRecord').addEventListener('click', () => $('#editRecordDialog').close());
$('#editRecordForm').addEventListener('submit', event => {
  event.preventDefault();
  const record = activeEvents(allEvents()).find(value => value.id === editingRecordId && ['use', 'replace'].includes(value.type));
  if (!record) { $('#editRecordError').textContent = '找不到這筆紀錄，請重新載入網頁。'; return; }
  const date = new Date($('#editRecordTime').value);
  if (Number.isNaN(date.getTime())) { $('#editRecordError').textContent = '請輸入有效的日期與時間。'; return; }
  if (addEvent('correct', record.itemId, { targetId: record.id, occurredAt: date.toISOString() })) {
    $('#editRecordDialog').close();
    undoEvent = null;
    $('#undoNotice').classList.add('hidden');
  }
});
$('#undoButton').addEventListener('click', () => {
  if (!undoEvent) return;
  if (addEvent('void', undoEvent.itemId, { targetId: undoEvent.id })) {
    undoEvent = null;
    $('#undoNotice').classList.add('hidden');
  }
});
$('#cloudSettingsButton').addEventListener('click', () => {
  $('#cloudError').textContent = '';
  $('#copySheetStatus').textContent = '';
  $('#sheetId').value = state.sheetId ? sheetUrl() : '';
  renderSync();
  $('#cloudDialog').showModal();
});
$('#closeCloud').addEventListener('click', () => $('#cloudDialog').close());
$('#copySheetButton').addEventListener('click', async () => {
  if (!state.sheetId) return;
  try {
    await navigator.clipboard.writeText(sheetUrl());
    $('#copySheetStatus').textContent = '已複製試算表網址。';
  } catch {
    $('#sheetId').focus();
    $('#sheetId').select();
    $('#copySheetStatus').textContent = '無法自動複製；已選取網址，請手動複製。';
  }
});
$('#createSheetButton').addEventListener('click', async () => {
  if (state.sheetId || syncBusy) return;
  if (!confirm('這會在目前選擇的 Google 帳號建立一份新的私人試算表。若你已有更換小記的試算表，請取消並貼入原表網址。確定要建立新表嗎？')) return;
  $('#createSheetButton').disabled = true;
  $('#cloudError').textContent = '';
  try {
    if (!accessToken) accessToken = await getToken();
    await createSheet();
    $('#cloudDialog').close();
    await syncCloud();
  } catch (error) {
    $('#cloudError').textContent = error.message || '建立試算表失敗';
  } finally {
    $('#createSheetButton').disabled = false;
    renderSync();
  }
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
    const sheetId = parseSheetId($('#sheetId').value);
    if (!sheetId) throw new Error('請貼入既有試算表網址；第一次使用則按「建立新的試算表」。');
    if (sheetId !== state.sheetId && state.pending.length && state.sheetId) throw new Error('目前仍有待同步紀錄，請先同步完成再更換試算表。');
    const previous = structuredClone(state);
    if (sheetId !== state.sheetId) { state.sheetId = sheetId; state.cloudEvents = []; accessToken = ''; }
    if (!save()) { state = previous; return; }
    syncError = '';
    $('#cloudDialog').close();
    render();
  } catch (error) { $('#cloudError').textContent = error.message; }
});

$('#connectButton').addEventListener('click', async () => {
  try {
    if (!state.sheetId) {
      $('#cloudError').textContent = '請貼入既有試算表網址；第一次使用則按「建立新的試算表」。';
      $('#sheetId').value = '';
      $('#cloudDialog').showModal();
      return;
    }
    if (!accessToken) accessToken = await getToken();
    await syncCloud();
  } catch (error) { syncError = error.message || '連結失敗'; renderSync(); }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
render();
