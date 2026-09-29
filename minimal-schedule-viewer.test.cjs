const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
function setup(transform = s => s) {
  let Card;
  const root = { innerHTML: '', addEventListener() {}, querySelector() { return null; }, querySelectorAll() { return []; } };
  const context = {
    HTMLElement: class { constructor() { this.isConnected = true; } attachShadow() { this.shadowRoot = root; } dispatchEvent(e) { this.event = e; } },
    customElements: { get() {}, define(name, cls) { Card = cls; } },
    window: { addEventListener() {}, removeEventListener() {} },
    document: { hidden: false, addEventListener() {}, removeEventListener() {} },
    setTimeout, clearTimeout, setInterval, clearInterval,
    requestAnimationFrame: () => 1, cancelAnimationFrame() {},
  };
  vm.createContext(context);
  // Expose pure parsing functions only inside the isolated test context.
  vm.runInContext(transform(fs.readFileSync('minimal-schedule-viewer.js', 'utf8')).replace('  const STYLE =', '  globalThis.helpers = { time, mode, parseWeek, escape, normalizeConfig, foreground };\n  const STYLE ='), context);
  const config = context.helpers.normalizeConfig({ entity: 'schedule.test', data_key: 'modus', states: {
    komfort: { label: 'Komfort', color: '#2e8540' }, reduziert: { label: 'Reduziert', color: '#1976c9' }, abwesend: { label: 'Abwesend', color: '#f39a00' }
  } });
  return { ...context.helpers, Card, root, config,
    mode: data => context.helpers.mode(data, config),
    parseWeek: raw => context.helpers.parseWeek(raw, config) };
}
const empty = () => Object.fromEntries(['monday','tuesday','wednesday','thursday','friday','saturday','sunday'].map(d => [d, []]));
test('time validation and HA midnight sentinel', () => {
  const { time } = setup();
  assert.equal(time('00:00'), 0);
  assert.equal(time('24:00:00', true), 1440);
  assert.equal(time('23:59:59.999999', true), 1440);
  assert.equal(time('12:30:30'), 750.5);
  for (const value of [undefined, null, '24:00', '25:00', '12:60', '10:00:60', '10:00oops', '1:00']) assert.ok(Number.isNaN(time(value)));
});
test('mode colors, missing values, strict typos, safe text', () => {
  const { mode, escape } = setup();
  ['komfort', 'reduziert', 'abwesend'].forEach((value, index) => assert.equal(mode({ modus: value }).kind, 'mapped'));
  for (const data of [undefined, {}, { modus: '' }, { modus: null }, { modus: ' ' }]) assert.equal(mode(data).label, 'Missing value');
  for (const value of ['Komfort', 'kom fort', 0, false, '<img onerror=alert(1)>']) assert.equal(mode({ modus: value }).kind, 'unknown');
  assert.equal(escape('<script>"&'), '&lt;script&gt;&quot;&amp;');
});
test('full week, proportional bounds, invalid days/times and overlaps', () => {
  const { parseWeek } = setup();
  const raw = empty();
  raw.monday = [{ from: '06:00', to: '08:00', data: { modus: 'komfort' } }, { from: '22:00', to: '24:00' }];
  let week = parseWeek(raw);
  assert.equal(week.length, 7);
  assert.equal(week[0].blocks[0].end - week[0].blocks[0].start, 120);
  assert.equal(week[0].blocks[1].label, 'Missing value');
  raw.tuesday = [{ from: '22:00', to: '06:00' }, {}, null];
  delete raw.wednesday;
  raw.thursday = [{ from: '06:00', to: '08:00' }, { from: '07:00', to: '09:00' }];
  week = parseWeek(raw);
  assert.equal(week[1].errors.length, 3);
  assert.equal(week[2].errors.length, 1);
  assert.equal(week[3].errors.length, 1);
  assert.equal(week[3].blocks[0].kind, 'error');
  assert.throws(() => parseWeek(null));
});
test('official response request, error retention, HTML escaping and stale response protection', async () => {
  const { Card, root, config } = setup();
  const card = new Card();
  card.setConfig(config);
  const raw = empty();
  raw.monday.push({ from: '00:00', to: '24:00', data: { modus: '<script>bad</script>' } });
  card._hass = { connected: true, states: { 'schedule.test': { attributes: { friendly_name: '<b>Name</b>' } } },
    callService: async (...args) => {
      assert.equal(args[0], 'schedule'); assert.equal(args[1], 'get_schedule');
      assert.equal(args[3].entity_id, 'schedule.test'); assert.equal(args[5], true);
      return { response: { 'schedule.test': raw } };
    } };
  await card._load();
  assert.equal(card._week.length, 7);
  assert.ok(root.innerHTML.includes('&lt;b&gt;Name&lt;/b&gt;'));
  assert.ok(!root.innerHTML.includes('<script>'));
  assert.ok(root.innerHTML.includes('height:100%'));
  assert.equal((root.innerHTML.match(/class="tick hour_style"/g) || []).length, 9);
  assert.ok(root.innerHTML.includes('>Mon</div>'));
  assert.ok(!root.innerHTML.includes('<button class="block'));
  assert.ok(!root.innerHTML.includes('class="legend"'));
  assert.ok(!root.innerHTML.includes('data-action="refresh"'));
  assert.ok(root.innerHTML.includes('title="Mon, 00:00–24:00:'));
  assert.ok(root.innerHTML.includes('class="schedule_name"'));
  assert.ok(root.innerHTML.includes('class="schedule_time"'));
  assert.ok(root.innerHTML.includes('block unknown')); 
  card._hass.callService = async () => { throw new Error('offline'); };
  await card._load();
  assert.ok(card._error.includes('offline'));
  assert.ok(root.innerHTML.includes('last successfully loaded schedule'));
  let resolve;
  card._hass.callService = () => new Promise(r => { resolve = r; });
  const pending = card._load();
  card.setConfig({ ...config, entity: 'schedule.other' });
  resolve({ response: { 'schedule.test': raw } });
  await pending;
  assert.equal(card._week, null);
  card.disconnectedCallback();
});
test('reload once after own helper dialog closes; ignore other dialogs and state changes', () => {
  const { Card, config } = setup();
  const card = new Card();
  card.setConfig(config);
  let loads = 0;
  card._load = () => { loads++; };
  const states = { 'schedule.test': { attributes: {} } };
  card.hass = { connected: true, states };
  assert.equal(loads, 1);
  card.hass = { connected: true, states: { 'schedule.test': { attributes: {} } } };
  assert.equal(loads, 1);
  card._editing = true;
  card._dialogClosed({ detail: { dialog: 'other-dialog' } });
  assert.equal(loads, 1);
  card._dialogClosed({ detail: { dialog: 'ha-more-info-dialog' } });
  assert.equal(loads, 2);
  card._dialogClosed({ detail: { dialog: 'ha-more-info-dialog' } });
  assert.equal(loads, 2);
  card.disconnectedCallback();
});

test('configuration validation, independent mappings and contrast', () => {
  const { normalizeConfig, foreground, config, Card } = setup();
  assert.equal(foreground('#fff'), '#000000');
  assert.equal(foreground('#000000'), '#ffffff');
  for (const patch of [{days: ['Mon']}, {data_key: ''}, {states: []}, {states: {x: {label: 'X', color: '#FF000'}}}, {entity: 'sensor.test'}]) {
    assert.throws(() => normalizeConfig({...config, ...patch}));
  }
  const first = new Card(), second = new Card();
  first.setConfig(config);
  second.setConfig({...config, days: ['Mo','Di','Mi','Do','Fr','Sa','So'], data_key: 'other'});
  assert.equal(first._config.data_key, 'modus');
  assert.equal(second._config.data_key, 'other');
  assert.equal(first._config.days[0], 'Mon');
  const proto = normalizeConfig({...config, states: JSON.parse('{"__proto__":{"label":"Safe","color":"#fff"}}')});
  assert.equal(proto.states.__proto__.label, 'Safe');
});

test('missing values and typos are red; time hides only when vertically clipped', () => {
  const { mode, Card } = setup();
  assert.equal(mode({}).color, '#b71c1c');
  assert.equal(mode({modus: 'komofrt'}).color, '#b71c1c');
  assert.equal(mode({modus: 'komofrt'}).label, 'komofrt');
  const card = new Card();
  const box = {top: 0, bottom: 60, height: 60};
  const line = {top: 14, bottom: 28, height: 14};
  const time = {style: {}, clientWidth: 60, getBoundingClientRect: () => line, parentElement: {getBoundingClientRect: () => box}};
  card.shadowRoot.querySelectorAll = () => [time];
  card._fitTimes();
  assert.equal(time.style.visibility, 'visible');
  time.clientWidth = 100;
  card._fitTimes();
  assert.equal(time.style.visibility, 'visible');
  box.bottom = 24; box.height = 24;
  card._fitTimes();
  assert.equal(time.style.visibility, 'hidden');
  box.height = 0; line.height = 0;
  card._fitTimes();
  assert.equal(time.style.visibility, 'hidden');
});
