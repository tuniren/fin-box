const assert = require('node:assert/strict');
const { test } = require('node:test');
const { buildSync } = require('esbuild');
const Module = require('node:module');
const path = require('node:path');

// Bundle the actual service without Electron or network access; no test files are written to the user's config.
function load(entry, electronMock) {
  const result = buildSync({ entryPoints: [path.resolve(entry)], bundle: true, platform: 'node', format: 'cjs', write: false, external: ['electron'] });
  const mod = new Module(path.resolve(entry + '.test.cjs'), module);
  mod.filename = path.resolve(entry + '.test.cjs');
  mod.paths = module.paths;
  if (electronMock) {
    const originalRequire = mod.require.bind(mod);
    mod.require = (name) => name === 'electron' ? electronMock : originalRequire(name);
  }
  mod._compile(result.outputFiles[0].text, mod.filename);
  return mod.exports;
}
const { IndustryMembershipService, SectorMarketService, parseSectorQuotes, parseSectorMinute } = load('src/main/sectors.ts');
const { chinaDate, normalizeIndustry } = load('src/shared/sector.ts');
const id = '01801095', other = '01801880';
const sectors = [{ id: other, name: '汽车', level: 1 }, { id, name: '乘用车', level: 2 }];
const quote = (id, now = 0) => ({ id, name: '乘用车', price: 101, previous_close: 100, change_percent: 1, time: '20261103100000', fetched_at: now });
const minute = () => ({ date: '20261103', points: [{ time: '09:30', price: 101 }], fetched_at: 0, quote: quote(id) });
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function membershipStore(industry) {
  let config = { stocks: [{ code: 'sz002594', alias: '原别名', tags: ['watchlist'], positions: [{ account: 'A', shares: 100, cost: 80 }], industry }] };
  return { read: () => structuredClone(config), save: (value) => { config = structuredClone(value); } };
}

test('归属每日一次：并发、同日重开和服务重建均不重复；跨日首次打开才更新', async () => {
  let day = '2026-11-03', calls = 0;
  const store = membershipStore();
  const response = deferred();
  const service = new IndustryMembershipService(store.read, store.save, () => { calls++; return response.promise; }, () => day);
  const first = service.open('SZ002594');
  const second = service.open('sz002594');
  assert.equal(first, second);
  assert.equal(store.read().stocks[0].industry.attempted_on, day);
  // Edit the config while the response is pending; response must merge into the latest stock.
  const edited = store.read(); edited.stocks[0].alias = '新别名'; edited.stocks[0].industry.show_in_float = true; store.save(edited);
  response.resolve(sectors); await first;
  assert.equal(store.read().stocks[0].alias, '新别名');
  assert.equal(store.read().stocks[0].positions[0].shares, 100);
  assert.equal(store.read().stocks[0].industry.show_in_float, true);
  assert.equal(store.read().stocks[0].industry.selected_id, id);
  await service.open('sz002594');
  const restarted = new IndustryMembershipService(store.read, store.save, async () => { calls++; return sectors; }, () => day);
  await restarted.open('sz002594'); assert.equal(calls, 1);
  day = '2026-11-04'; assert.equal(calls, 1);
  await restarted.open('sz002594'); assert.equal(calls, 2);
});

test('归属失败保留旧值和用户选择，持久化尝试日期，同日不重试', async () => {
  const store = membershipStore(normalizeIndustry({ sectors, selected_id: other, updated_on: '2026-11-02', show_near_price: true }));
  let calls = 0;
  const service = new IndustryMembershipService(store.read, store.save, async () => { calls++; throw new Error('timeout'); }, () => '2026-11-03');
  await service.open('sz002594'); await service.open('sz002594');
  assert.equal(calls, 1);
  const saved = store.read().stocks[0].industry;
  assert.equal(saved.selected_id, other); assert.equal(saved.updated_on, '2026-11-02');
  assert.equal(saved.attempted_on, '2026-11-03'); assert.equal(saved.show_near_price, true);
  assert.equal(service.errors.sz002594, 'timeout');
});

test('空归属正常持久化；不支持的市场不请求', async () => {
  const store = membershipStore(); let calls = 0;
  const service = new IndustryMembershipService(store.read, store.save, async () => { calls++; return []; }, () => '2026-11-03');
  await service.open('hk01211'); assert.equal(calls, 0);
  await service.open('sz002594'); await service.open('sz002594');
  assert.equal(calls, 1); assert.deepEqual(store.read().stocks[0].industry.sectors, []);
  assert.equal(store.read().stocks[0].industry.updated_on, '2026-11-03');
});

test('行业行情批量去重、并发去重、跟随刷新配置；分时按需、无订阅不请求', async () => {
  let now = 0, calls = 0, minuteCalls = 0, requested;
  const response = deferred();
  const service = new SectorMarketService(() => {}, {
    now: () => now,
    quotes: async (ids) => { calls++; requested = ids; if (calls === 1) return response.promise; return Object.fromEntries(ids.map((id) => [id, quote(id, now)])); },
    minute: async () => { minuteCalls++; return minute(); }
  });
  const initial = service.refresh([id, id, other], [], 1000);
  await service.refresh([id, other], [], 1000);
  assert.equal(calls, 1); assert.deepEqual(requested, [id, other]); assert.equal(minuteCalls, 0);
  response.resolve({ [id]: quote(id), [other]: quote(other) }); await initial;
  now = 500; await service.refresh([id], [], 1000); assert.equal(calls, 1);
  now = 1000; await service.refresh([id], [id, id], 1000); assert.equal(calls, 1); assert.equal(minuteCalls, 1);
  now = 1500; await service.refresh([id], [id], 500); assert.equal(calls, 1); assert.equal(minuteCalls, 2);
  now = 9999; await service.refresh([], [], 500); assert.equal(calls, 1); assert.equal(minuteCalls, 2);
});

test('行情失败保留最后成功值，遵循退避和 Retry-After，不按股价频率重试', async () => {
  let now = 0, calls = 0;
  const service = new SectorMarketService(() => {}, {
    now: () => now, minute: async () => minute(),
    quotes: async () => { calls++; if (calls === 1) return { [id]: quote(id) }; throw Object.assign(new Error('HTTP 429'), { retryAfter: 120000 }); }
  });
  await service.refresh([id], [], 500);
  now = 500; await service.refresh([id], [], 500);
  assert.equal(service.quotes[id].price, 101); assert.equal(calls, 2);
  now = 60500; await service.refresh([id], [], 500); assert.equal(calls, 2);
  now = 120500; await service.refresh([id], [], 500); assert.equal(calls, 3);
  now += 1000; await service.refresh([id], [], 500); assert.equal(calls, 3);
});

test('解析腾讯行情和分时，保留前导零并拒绝缺失价格', () => {
  const row = Array(33).fill(''); row[1] = '乘用车'; row[3] = '101'; row[4] = '100'; row[30] = '20261103100000'; row[32] = '1';
  assert.equal(parseSectorQuotes(`v_pt${id}="${row.join('~')}";`)[id].change_percent, 1);
  row[3] = ''; assert.deepEqual(parseSectorQuotes(`v_pt${id}="${row.join('~')}";`), {});
  const parsed = parseSectorMinute({ code: 0, data: { [`pt${id}`]: { data: { date: '20261103', data: ['0930 101 10', 'bad'] } } } }, id);
  assert.deepEqual(parsed.points, [{ time: '09:30', price: 101 }]);
  assert.throws(() => parseSectorMinute({ code: -1 }, id));
  assert.equal(normalizeIndustry({ sectors }).selected_id, id);
  assert.equal(chinaDate(Date.parse('2026-11-03T16:01:00Z')), '2026-11-04');
});

test('选股 YAML 配置往返保存行业、日期、开关和原持仓，兼容旧配置', (t) => {
  const fs = require('node:fs'), os = require('node:os');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-box-sector-config-'));
  t.after(() => {
    assert.equal(path.dirname(path.resolve(dir)), path.resolve(os.tmpdir()));
    assert.match(path.basename(dir), /^fin-box-sector-config-/);
    fs.rmSync(dir, { recursive: true, force: true });
  });
  const { ConfigManager } = load('src/main/config.ts', { app: { getPath: () => dir } });
  const manager = new ConfigManager();
  const config = manager.loadOrDefault();
  assert.equal(config.stocks[0].industry, undefined);
  assert.equal(config.watch_float.show_industry, true);
  config.watch_float.show_industry = false;
  config.stocks[0].industry = normalizeIndustry({ sectors, selected_id: other, attempted_on: '2026-11-03', updated_on: '2026-11-03', show_in_float: true, show_near_price: true });
  manager.save(config);
  const reloaded = new ConfigManager().loadOrDefault();
  assert.equal(reloaded.watch_float.show_industry, false);
  assert.deepEqual(reloaded.stocks[0], config.stocks[0]);
  assert.equal(reloaded.stocks[0].industry.sectors[0].id, '01801880');
  manager.save(reloaded);
  assert.deepEqual(manager.loadOrDefault().stocks[0].industry, config.stocks[0].industry);
});
