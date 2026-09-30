export const STORAGE_KEY = 'replacement-diary-v1';
export const SHEET_NAME = 'Events';
export const SHEET_HEADER = ['EventID', 'CreatedAt', 'Type', 'ItemID', 'DataJSON'];
export const DEFAULT_ITEMS = [
  { id: 'cat-litter', name: '貓砂', intervalValue: 1, intervalUnit: 'months', active: true },
  { id: 'contact-lenses', name: '隱形眼鏡', intervalValue: 1, intervalUnit: 'months', active: true }
];

export function emptyState() {
  return { version: 1, clientId: '', sheetId: '', cloudEvents: [], pending: [] };
}

export function validInstant(value) {
  return typeof value === 'string' && !Number.isNaN(Date.parse(value));
}

export function validateEvent(event) {
  if (!event || typeof event.id !== 'string' || !/^[\w-]{1,100}$/.test(event.id) ||
      !validInstant(event.createdAt) || typeof event.itemId !== 'string' ||
      !/^[\w-]{1,100}$/.test(event.itemId) || !event.payload || typeof event.payload !== 'object') {
    throw new Error('紀錄格式不正確');
  }
  const p = event.payload;
  if (event.type === 'config') {
    if (typeof p.name !== 'string' || !p.name.trim() || p.name.length > 60 ||
        !Number.isInteger(p.intervalValue) || p.intervalValue < 1 || p.intervalValue > 365 ||
        !['days', 'weeks', 'months'].includes(p.intervalUnit) || typeof p.active !== 'boolean') {
      throw new Error('項目設定格式不正確');
    }
  } else if (event.type === 'use') {
    if (!validInstant(p.usedAt)) throw new Error('使用日期格式不正確');
  } else if (event.type === 'replace') {
    if (!validInstant(p.replacedAt) || !validInstant(p.usedAt)) throw new Error('更換日期格式不正確');
  } else if (event.type === 'void') {
    if (typeof p.targetId !== 'string' || !/^[\w-]{1,100}$/.test(p.targetId)) throw new Error('復原紀錄格式不正確');
  } else {
    throw new Error('未知的紀錄種類');
  }
  return event;
}

export function validateState(value) {
  if (!value || value.version !== 1 || typeof value.clientId !== 'string' ||
      typeof value.sheetId !== 'string' || !Array.isArray(value.cloudEvents) ||
      !Array.isArray(value.pending) || value.cloudEvents.length + value.pending.length > 100000) {
    throw new Error('手機副本格式不正確');
  }
  [...value.cloudEvents, ...value.pending].forEach(validateEvent);
  return value;
}

export function uniqueEvents(events) {
  const seen = new Set();
  return events.filter(event => {
    if (seen.has(event.id)) return false;
    seen.add(event.id);
    return true;
  });
}

export function activeEvents(events) {
  const unique = uniqueEvents(events);
  const voided = new Set(unique.filter(event => event.type === 'void').map(event => event.payload.targetId));
  return unique.filter(event => event.type !== 'void' && !voided.has(event.id));
}

export function deriveItems(events) {
  const items = new Map(DEFAULT_ITEMS.map(item => [item.id, { ...item, usedAt: null, replacedAt: null }]));
  for (const event of activeEvents(events)) {
    let item = items.get(event.itemId);
    if (event.type === 'config') {
      if (!item) item = { id: event.itemId, usedAt: null, replacedAt: null };
      Object.assign(item, event.payload);
      items.set(event.itemId, item);
    } else if (item && event.type === 'use') {
      item.usedAt = event.payload.usedAt;
    } else if (item && event.type === 'replace') {
      item.replacedAt = event.payload.replacedAt;
      item.usedAt = event.payload.usedAt;
    }
  }
  return [...items.values()].filter(item => item.active);
}

export function addInterval(isoDate, amount, unit) {
  const result = new Date(isoDate);
  if (Number.isNaN(result.getTime())) throw new Error('日期無效');
  if (unit === 'months') {
    const day = result.getDate();
    result.setDate(1);
    result.setMonth(result.getMonth() + amount);
    const lastDay = new Date(result.getFullYear(), result.getMonth() + 1, 0).getDate();
    result.setDate(Math.min(day, lastDay));
  } else if (unit === 'weeks' || unit === 'days') {
    result.setDate(result.getDate() + amount * (unit === 'weeks' ? 7 : 1));
  } else {
    throw new Error('週期單位無效');
  }
  return result;
}

export function eventToRow(event) {
  validateEvent(event);
  return [event.id, event.createdAt, event.type, event.itemId, JSON.stringify(event.payload)];
}

export function rowToEvent(row) {
  if (!Array.isArray(row) || row.length < 5) throw new Error('試算表列資料不足');
  return validateEvent({ id: row[0], createdAt: row[1], type: row[2], itemId: row[3], payload: JSON.parse(row[4]) });
}
