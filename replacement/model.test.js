import test from 'node:test';
import assert from 'node:assert/strict';
import { activeEvents, addInterval, deriveItems, eventToRow, rowToEvent, uniqueEvents } from './model.js';

test('one calendar month clamps at the end of February', () => {
  assert.equal(addInterval('2025-01-31T10:00:00+08:00', 1, 'months').getDate(), 28);
  assert.equal(addInterval('2024-01-31T10:00:00+08:00', 1, 'months').getDate(), 29);
});

test('replacement records actual change and starts a new use cycle', () => {
  const events = [
    { id: 'e1', createdAt: '2026-01-01T00:00:00Z', type: 'use', itemId: 'cat-litter', payload: { usedAt: '2026-01-01T02:00:00Z' } },
    { id: 'e2', createdAt: '2026-02-03T00:00:00Z', type: 'replace', itemId: 'cat-litter', payload: { replacedAt: '2026-02-02T01:00:00Z', usedAt: '2026-02-03T01:00:00Z' } }
  ];
  const item = deriveItems(events).find(value => value.id === 'cat-litter');
  assert.equal(item.replacedAt, '2026-02-02T01:00:00Z');
  assert.equal(item.usedAt, '2026-02-03T01:00:00Z');
  assert.equal(uniqueEvents([...events, events[1]]).length, 2);
  assert.deepEqual(rowToEvent(eventToRow(events[1])), events[1]);
});

test('interval settings may be adjusted without losing prior events', () => {
  const config = { id: 'config1', createdAt: '2026-01-01T00:00:00Z', type: 'config', itemId: 'contact-lenses', payload: { name: '隱形眼鏡', intervalValue: 2, intervalUnit: 'weeks', active: true } };
  const item = deriveItems([config]).find(value => value.id === 'contact-lenses');
  assert.equal(item.intervalValue, 2);
  assert.equal(item.intervalUnit, 'weeks');
});

test('undoing an accidental replacement restores the previous cycle', () => {
  const use = { id: 'used1', createdAt: '2026-01-01T00:00:00Z', type: 'use', itemId: 'cat-litter', payload: { usedAt: '2026-01-01T00:00:00Z' } };
  const replace = { id: 'change1', createdAt: '2026-02-01T00:00:00Z', type: 'replace', itemId: 'cat-litter', payload: { replacedAt: '2026-02-01T00:00:00Z', usedAt: '2026-02-01T00:00:00Z' } };
  const undo = { id: 'undo1', createdAt: '2026-02-01T00:01:00Z', type: 'void', itemId: 'cat-litter', payload: { targetId: 'change1' } };
  assert.equal(deriveItems([use, replace, undo]).find(item => item.id === 'cat-litter').usedAt, use.payload.usedAt);
  assert.deepEqual(activeEvents([use, replace, undo]), [use]);
  assert.deepEqual(rowToEvent(eventToRow(undo)), undo);
});
