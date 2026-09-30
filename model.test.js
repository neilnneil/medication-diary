import test from 'node:test';
import assert from 'node:assert/strict';
import { localDateKey, dosesForDate, doseKey, validateData, defaultData } from './model.js';

test('每日與指定星期只出現在排定日，已服用狀態按日期及時間區分', () => {
  const date = new Date(2026, 8, 30, 12); // Wednesday
  const medicines = [
    { id: 'a', name: '早藥', time: '08:00', frequency: 'daily', weekdays: [] },
    { id: 'b', name: '週三藥', time: '20:00', frequency: 'weekly', weekdays: [3] },
    { id: 'c', name: '週四藥', time: '09:00', frequency: 'weekly', weekdays: [4] }
  ];
  const records = [{ doseKey: doseKey('a', '2026-09-30') }];
  const doses = dosesForDate(medicines, records, date);
  assert.deepEqual(doses.map(d => [d.medicine.id, d.taken]), [['a', true], ['b', false]]);
  assert.equal(localDateKey(date), '2026-09-30');
});

test('修改服用時間後，同一天的紀錄仍算已服用', () => {
  const date = new Date(2026, 8, 30, 12);
  const medicines = [{ id: 'a', name: '藥', time: '20:00', frequency: 'daily', weekdays: [] }];
  const records = [{ doseKey: doseKey('a', '2026-09-30') }];
  assert.equal(dosesForDate(medicines, records, date)[0].taken, true);
});

test('備份會拒絕不完整的藥品設定', () => {
  const data = defaultData();
  data.medicines[0].frequency = 'weekly';
  assert.throws(() => validateData(data));
});
