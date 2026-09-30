import { STORAGE_KEY, localDateKey, dosesForDate, recordMatchesDose, validateData, defaultData } from './model.js';

const $ = selector => document.querySelector(selector);
const dateFormat = new Intl.DateTimeFormat('zh-TW', { month: 'long', day: 'numeric', weekday: 'long' });
const dateTimeFormat = new Intl.DateTimeFormat('zh-TW', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' });
let data;
let editingId = null;

try {
  const saved = localStorage.getItem(STORAGE_KEY);
  data = saved ? validateData(JSON.parse(saved)) : defaultData();
} catch {
  data = defaultData();
  alert('無法讀取原有資料。畫面已顯示預設藥品；請先不要儲存，並檢查瀏覽器資料或備份。');
}

function persist() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    return true;
  } catch {
    alert('資料儲存失敗。請檢查裝置空間或瀏覽器的儲存設定。');
    return false;
  }
}

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderToday() {
  const now = new Date();
  const doses = dosesForDate(data.medicines, data.records, now);
  const taken = doses.filter(dose => dose.taken).length;
  const overdue = doses.filter(dose => !dose.taken && dose.medicine.time < `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`);
  $('#todayDate').textContent = dateFormat.format(now);
  $('#todaySummary').textContent = doses.length ? `已記錄 ${taken} / ${doses.length} 項` : '今天沒有排定用藥';
  $('#doseCount').textContent = `${doses.length} 項`;
  const progress = doses.length ? Math.round(taken / doses.length * 100) : 100;
  $('#progressFill').style.width = `${progress}%`;
  $('.progress').setAttribute('aria-valuenow', String(progress));
  const reminder = $('#reminder');
  reminder.classList.toggle('hidden', overdue.length === 0);
  reminder.textContent = overdue.length ? `提醒：今天有 ${overdue.length} 項已過預定時間，尚未記錄服用。請依醫囑確認是否需要服用。` : '';

  const list = $('#doseList');
  list.replaceChildren();
  if (!doses.length) list.append(element('div', 'empty', '今天沒有排定用藥。可到「管理藥品」新增或調整。'));
  for (const dose of doses) {
    const card = element('article', `dose-card${dose.taken ? ' is-taken' : ''}`);
    const time = element('div', 'dose-time', dose.medicine.time);
    const content = element('div', 'dose-content');
    content.append(element('h3', '', dose.medicine.name));
    content.append(element('p', '', dose.taken ? '已記錄服用' : '尚未記錄'));
    const button = element('button', dose.taken ? 'undo-button' : 'taken-button', dose.taken ? '復原' : '記錄已服用');
    button.type = 'button';
    button.setAttribute('aria-label', `${dose.medicine.name} ${dose.medicine.time} ${dose.taken ? '復原服用紀錄' : '記錄已服用'}`);
    button.addEventListener('click', () => toggleDose(dose));
    card.append(time, content, button);
    list.append(card);
  }
}

function toggleDose(dose) {
  const previous = structuredClone(data.records);
  const index = data.records.findIndex(record => recordMatchesDose(record, dose.key));
  if (index >= 0) data.records.splice(index, 1);
  else data.records.push({ doseKey: dose.key, medicineName: dose.medicine.name, dateKey: dose.dateKey, time: dose.medicine.time, takenAt: new Date().toISOString() });
  if (!persist()) data.records = previous;
  render();
}

function renderHistory() {
  const list = $('#historyList');
  list.replaceChildren();
  const records = [...data.records].sort((a, b) => b.takenAt.localeCompare(a.takenAt)).slice(0, 20);
  if (!records.length) { list.append(element('div', 'empty', '還沒有服用紀錄。')); return; }
  for (const record of records) {
    const row = element('div', 'history-row');
    const label = element('div');
    label.append(element('strong', '', record.medicineName));
    label.append(element('span', '', `預定 ${record.dateKey} ${record.time}`));
    row.append(label, element('time', '', dateTimeFormat.format(new Date(record.takenAt))));
    list.append(row);
  }
}

function scheduleText(medicine) {
  if (medicine.frequency === 'daily') return `每天 ${medicine.time}`;
  const names = ['日', '一', '二', '三', '四', '五', '六'];
  return `週${medicine.weekdays.map(day => names[day]).join('、')} · ${medicine.time}`;
}

function renderMedicines() {
  const list = $('#medicineList');
  list.replaceChildren();
  if (!data.medicines.length) list.append(element('div', 'empty', '尚未設定藥品。'));
  for (const medicine of [...data.medicines].sort((a, b) => a.time.localeCompare(b.time))) {
    const row = element('div', 'medicine-row');
    const info = element('div');
    info.append(element('strong', '', medicine.name), element('span', '', scheduleText(medicine)));
    const button = element('button', 'text-button', '編輯');
    button.type = 'button';
    button.addEventListener('click', () => openEditor(medicine.id));
    row.append(info, button);
    list.append(row);
  }
}

function render() { renderToday(); renderHistory(); renderMedicines(); }

function openEditor(id = null) {
  editingId = id;
  const medicine = data.medicines.find(item => item.id === id);
  $('#medicineForm').reset();
  $('#formError').textContent = '';
  $('#editorTitle').textContent = medicine ? '編輯藥品' : '新增藥品';
  $('#medicineName').value = medicine?.name ?? '';
  $('#medicineTime').value = medicine?.time ?? '08:00';
  $(`input[name="frequency"][value="${medicine?.frequency ?? 'daily'}"]`).checked = true;
  document.querySelectorAll('#weekdaysField input').forEach(input => { input.checked = medicine?.weekdays.includes(Number(input.value)) ?? false; });
  $('#deleteMedicine').classList.toggle('hidden', !medicine);
  updateFrequency();
  $('#editorDialog').showModal();
}

function updateFrequency() { $('#weekdaysField').classList.toggle('hidden', $('input[name="frequency"]:checked').value !== 'weekly'); }

$('#settingsButton').addEventListener('click', () => $('#settingsDialog').showModal());
$('#closeSettings').addEventListener('click', () => $('#settingsDialog').close());
$('#addMedicine').addEventListener('click', () => openEditor());
$('#closeEditor').addEventListener('click', () => $('#editorDialog').close());
document.querySelectorAll('input[name="frequency"]').forEach(input => input.addEventListener('change', updateFrequency));

$('#medicineForm').addEventListener('submit', event => {
  event.preventDefault();
  const name = $('#medicineName').value.trim();
  const time = $('#medicineTime').value;
  const frequency = $('input[name="frequency"]:checked').value;
  const weekdays = [...document.querySelectorAll('#weekdaysField input:checked')].map(input => Number(input.value));
  if (!name || (frequency === 'weekly' && !weekdays.length)) {
    $('#formError').textContent = frequency === 'weekly' ? '請至少選擇一個星期。' : '請輸入藥品名稱。';
    return;
  }
  const previous = structuredClone(data.medicines);
  const medicine = { id: editingId ?? crypto.randomUUID(), name, time, frequency, weekdays: frequency === 'weekly' ? weekdays : [] };
  const index = data.medicines.findIndex(item => item.id === editingId);
  if (index >= 0) data.medicines[index] = medicine;
  else data.medicines.push(medicine);
  if (!persist()) { data.medicines = previous; return; }
  $('#editorDialog').close();
  render();
});

$('#deleteMedicine').addEventListener('click', () => {
  const medicine = data.medicines.find(item => item.id === editingId);
  if (!medicine || !confirm(`刪除「${medicine.name}」？過去的服用紀錄會保留。`)) return;
  const previous = data.medicines;
  data.medicines = data.medicines.filter(item => item.id !== editingId);
  if (!persist()) { data.medicines = previous; return; }
  $('#editorDialog').close();
  render();
});

$('#exportButton').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = element('a');
  link.href = url;
  link.download = `用藥小記-${localDateKey(new Date())}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

$('#importButton').addEventListener('click', () => $('#importInput').click());
$('#importInput').addEventListener('change', async event => {
  const file = event.target.files?.[0];
  event.target.value = '';
  if (!file) return;
  if (file.size > 15_000_000) { alert('備份檔案過大。'); return; }
  try {
    const imported = validateData(JSON.parse(await file.text()));
    if (!confirm('匯入會取代這台裝置目前的藥品與紀錄。確定繼續？')) return;
    const previous = data;
    data = imported;
    if (!persist()) { data = previous; return; }
    render();
    alert('備份匯入完成。');
  } catch (error) { alert(`無法匯入：${error.message}`); }
});

document.addEventListener('visibilitychange', () => { if (!document.hidden) render(); });
setInterval(renderToday, 30_000);
if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(() => {});
render();
