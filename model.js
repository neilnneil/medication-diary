export const STORAGE_KEY = 'medication-diary-v1';

export function localDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

export function isScheduled(medicine, date) {
  return medicine.frequency === 'daily' ||
    (medicine.frequency === 'weekly' && medicine.weekdays.includes(date.getDay()));
}

export function doseKey(medicineId, dateKey) {
  return `${medicineId}|${dateKey}`;
}

export function recordMatchesDose(record, key) {
  return record.doseKey === key || record.doseKey.startsWith(`${key}|`);
}

export function dosesForDate(medicines, records, date) {
  const dateKey = localDateKey(date);
  return medicines.filter(medicine => isScheduled(medicine, date)).map(medicine => {
    const key = doseKey(medicine.id, dateKey);
    return { medicine, key, taken: records.some(record => recordMatchesDose(record, key)), dateKey };
  }).sort((a, b) => a.medicine.time.localeCompare(b.medicine.time) || a.medicine.name.localeCompare(b.medicine.name));
}

export function validTime(value) {
  return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

export function validateData(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.medicines) || !Array.isArray(data.records)) throw new Error('備份格式不正確');
  if (data.medicines.length > 500 || data.records.length > 100000) throw new Error('備份資料過大');
  const ids = new Set();
  for (const medicine of data.medicines) {
    if (!medicine || typeof medicine.id !== 'string' || medicine.id.length > 100 || ids.has(medicine.id) ||
      typeof medicine.name !== 'string' || !medicine.name.trim() || medicine.name.length > 60 || !validTime(medicine.time) ||
      !['daily', 'weekly'].includes(medicine.frequency) || !Array.isArray(medicine.weekdays) ||
      medicine.weekdays.some(day => !Number.isInteger(day) || day < 0 || day > 6) ||
      (medicine.frequency === 'weekly' && medicine.weekdays.length === 0)) throw new Error('藥品資料不正確');
    ids.add(medicine.id);
  }
  for (const record of data.records) {
    if (!record || typeof record.doseKey !== 'string' || record.doseKey.length > 200 ||
      typeof record.medicineName !== 'string' || record.medicineName.length > 60 ||
      !/^\d{4}-\d{2}-\d{2}$/.test(record.dateKey) || !validTime(record.time) ||
      typeof record.takenAt !== 'string' || Number.isNaN(Date.parse(record.takenAt))) throw new Error('用藥紀錄不正確');
  }
  return data;
}

export function defaultData() {
  return {
    version: 1,
    medicines: [
      { id: 'starter-headache', name: '頭痛藥', time: '21:00', frequency: 'daily', weekdays: [] },
      { id: 'starter-mood', name: '憂鬱藥', time: '21:00', frequency: 'daily', weekdays: [] },
      { id: 'starter-iron', name: '補血藥', time: '08:00', frequency: 'daily', weekdays: [] }
    ],
    records: []
  };
}
