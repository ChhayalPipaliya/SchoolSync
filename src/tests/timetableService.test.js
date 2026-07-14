const test = require('node:test');
const assert = require('node:assert/strict');
const { buildTimetableGrid } = require('../services/timetableService');

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
