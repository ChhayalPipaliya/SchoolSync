const test = require('node:test');
const assert = require('node:assert/strict');
const db = require('../config/database');
const { buildTimetableGrid, normalizePeriodSlotType } = require('../services/timetableService');

test.after(async () => {
  await db.checkConnection();
  await db.pool.promise().end();
});

test('buildTimetableGrid maps entries to the correct day and period slots', () => {
  const days = ['Monday', 'Tuesday'];
  const periods = [
    { id: 10, label: 'Period 1' },
    { id: 11, label: 'Period 2' }
  ];
  const entries = [
    { day_of_week: 'Monday', period_slot_id: 10, subject_name: 'Maths' },
    { day_of_week: 'Tuesday', period_slot_id: 11, subject_name: 'English' }
  ];

  const grid = buildTimetableGrid({ days, periods, entries });

  assert.equal(grid.Monday[10].subject_name, 'Maths');
  assert.equal(grid.Monday[11], null);
  assert.equal(grid.Tuesday[11].subject_name, 'English');
});

test('buildTimetableGrid returns null cells when no timetable entry exists', () => {
  const grid = buildTimetableGrid({
    days: ['Monday'],
    periods: [{ id: 1, label: 'Period 1' }],
    entries: []
  });

  assert.equal(grid.Monday[1], null);
});

test('normalizePeriodSlotType accepts canonical and legacy form values', () => {
  assert.equal(normalizePeriodSlotType('teaching'), 'teaching');
  assert.equal(normalizePeriodSlotType('regular'), 'teaching');
  assert.equal(normalizePeriodSlotType('break'), 'short_break');
  assert.equal(normalizePeriodSlotType('lunch'), 'lunch_break');
  assert.equal(normalizePeriodSlotType('assembly'), 'assembly');
  assert.equal(normalizePeriodSlotType('', true), 'short_break');
  assert.equal(normalizePeriodSlotType('unsupported'), null);
});
