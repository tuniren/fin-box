// Isolated, hidden Electron smoke test. All market/IPC data is mocked; no user configuration or network is used.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');

if (!process.versions.electron) {
  const env = { ...process.env }; delete env.ELECTRON_RUN_AS_NODE;
  const child = require('node:child_process').spawn(require('electron'), [__filename], { env, stdio: 'inherit', windowsHide: true });
  child.on('exit', (code) => process.exit(code ?? 1));
} else {
  const { app, BrowserWindow, session } = require('electron');
  const root = path.resolve(__dirname, '..');
  const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'fin-box-sector-ui-'));
  app.setPath('userData', testDir);
  app.disableHardwareAcceleration();
  app.whenReady().then(async () => {
    session.defaultSession.webRequest.onBeforeRequest((details, callback) => callback({ cancel: /^https?:/i.test(details.url) }));
    const { build } = require('esbuild');
    const entry = `
      import React from 'react';
      import { createRoot } from 'react-dom/client';
      import { I18nProvider } from './src/renderer/i18n';
      import { defaultThemes } from './src/shared/theme';
      import './src/renderer/App.css';
      const theme = defaultThemes.simple;
      const industry = {sectors:[{id:'01801880',name:'汽车',level:1},{id:'01801095',name:'乘用车',level:2}], selected_id:'01801095', attempted_on:'2026-11-03', updated_on:'2026-11-03', show_near_price:false, show_in_float:false};
      const stock = {config:{code:'sz002594',tags:['watchlist'],positions:[],industry},market:{name:'比亚迪',current_price:84.6,prev_close:84,open:84,high:85,low:83,time:'10:00'}};
      const colors={name:'#333333',price:'#333333',change:'#333333',day_profit:'#333333'};
      const style={font_family:'Microsoft YaHei',font_size:12,text_color:'#333333',column_colors:colors,metric_colors:{change:{up:'#e00',down:'#090'},day_profit:{up:'#e00',down:'#090'}},background_color:'#ffffff',background_opacity:1,border_color:'#cccccc',show_border:true};
      let snapshot={config:{stocks:[stock.config],current_theme:'simple',themes:defaultThemes,hide_zero_shares:false,watch_float:{stock_codes:['sz002594'],columns:['name','price','change'],layout:'vertical',show_news:false,style}},stocks:[stock],sector_quotes:{'01801095':{id:'01801095',name:'乘用车',price:101,previous_close:100,change_percent:1,time:'20261103100000',fetched_at:1},'01801880':{id:'01801880',name:'汽车',price:201,previous_close:200,change_percent:.5,time:'20261103100000',fetched_at:1}},sector_minutes:{'01801095':{date:'20261103',points:[{time:'09:30',price:100},{time:'09:31',price:100.5},{time:'09:32',price:101}],fetched_at:1}}};
      const listeners=new Set();
      window.test={opens:0,interests:[],sizes:[],snapshot:()=>snapshot};
      window.finBox={
        getState:async()=>snapshot,
        openStockIndustry:async()=>{window.test.opens++},
        updateStockIndustry:async(code,patch)=>{Object.assign(industry,patch);snapshot={...snapshot};listeners.forEach(fn=>fn(snapshot));},
        updateWatchFloatConfig:async(patch)=>{snapshot={...snapshot,config:{...snapshot.config,watch_float:{...snapshot.config.watch_float,...patch}}};listeners.forEach(fn=>fn(snapshot));},
        setSectorInterest:async(key,interest)=>{window.test.interests.push(interest)},
        onState:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
        resizeWindow:async(w,h)=>{window.test.sizes.push([w,h])},resizeWindowHeight:async()=>{},
        onCycleStock:()=>()=>{},openWatchlistFloatSettings:async()=>{}
      };
      // Require after installing the mock: modules bind window.finBox during evaluation.
      const {IndustryPanel,SectorBadge}=require('./src/renderer/components/IndustryPanel');
      const {WatchlistFloatView,CamouflageFloatView}=require('./src/renderer/components/FloatingWindows');
      const {GroupedWatchlist}=require('./src/renderer/components/WatchTree');
      const {WatchFloatIndustrySettings}=require('./src/renderer/components/WatchFloatIndustrySettings');
      function Settings(){const [state,setState]=React.useState(snapshot);React.useEffect(()=>window.finBox.onState(setState),[]);return <main style={{padding:20,background:'#fff',height:'100vh'}}><WatchFloatIndustrySettings stocks={[...state.stocks,{config:{code:'sh600000',tags:[],positions:[]},market:{name:'浦发银行'}}]} config={state.config.watch_float} onConfigChange={window.finBox.updateWatchFloatConfig}/></main>}
      function Main(){const [state,setState]=React.useState(snapshot);React.useEffect(()=>window.finBox.onState(setState),[]);return <main style={{padding:20,color:'#333',background:'#fff',height:'100vh'}}><div>84.60 <SectorBadge state={state} stock={state.stocks[0]} theme={theme}/></div><IndustryPanel state={state} stock={state.stocks[0]} theme={theme}/><div style={{width:300,marginTop:12}}><GroupedWatchlist state={state} stocks={state.stocks} groupNames={['watchlist']} groupOrder={{}} theme={theme} onSelect={()=>{}} expandedKeys={['watch-root','watch-group:watchlist']} onExpandedKeysChange={()=>{}} readOnly/></div></main>}
      const component=location.hash==='#settings'?<Settings/>:location.hash==='#watch'?<WatchlistFloatView/>:location.hash==='#float'?<CamouflageFloatView/>:<Main/>;
      createRoot(document.getElementById('root')).render(<I18nProvider>{component}</I18nProvider>);
    `;
    await build({ stdin: { contents: entry, resolveDir: root, loader: 'tsx' }, bundle: true, outfile: path.join(testDir, 'ui.js'), platform: 'browser', jsx: 'automatic',
      plugins: [{ name: 'yaml-raw', setup(build) {
        build.onResolve({ filter: /\.yaml\?raw$/ }, args => ({ path: path.resolve(args.resolveDir, args.path.replace(/\?raw$/, '')), namespace: 'raw' }));
        build.onLoad({ filter: /.*/, namespace: 'raw' }, args => ({ contents: fs.readFileSync(args.path, 'utf8'), loader: 'text' }));
      }}] });
    fs.writeFileSync(path.join(testDir, 'index.html'), '<!doctype html><meta charset="utf-8"><link rel="stylesheet" href="ui.css"><div id="root"></div><script src="ui.js"></script>');
    const win = new BrowserWindow({ show: false, width: 760, height: 550, webPreferences: { contextIsolation: false, nodeIntegration: false, backgroundThrottling: false } });
    const errors = [];
    win.webContents.on('console-message', (event) => { if (event.level === 'error') errors.push(event.message); });
    const evaluate = (code) => win.webContents.executeJavaScript(code);
    const until = async (code) => {
      const deadline = Date.now() + 5000;
      while (Date.now() < deadline) {
        if (await evaluate(`Boolean(${code})`)) return;
        await new Promise(resolve => setTimeout(resolve, 40));
      }
      throw new Error('UI condition timed out: ' + code + '\n' + JSON.stringify({ errors, body: await evaluate('document.body.innerText') }));
    };
    await win.loadFile(path.join(testDir, 'index.html'));
    await until('document.querySelector("select") && !document.querySelector("select").disabled');
    assert.equal(await evaluate('window.test.opens'), 1);
    assert.equal(await evaluate('document.querySelector("select").value'), '01801095');
    await evaluate('document.querySelectorAll("input[type=checkbox]")[0].click()');
    await until('document.querySelector(".sector-badge")');
    await until('document.querySelector(".watch-tree-stock .sector-badge")');
    assert.equal(await evaluate('document.querySelector(".watch-tree-stock").getBoundingClientRect().height'), 28);
    assert.equal(await evaluate('document.querySelector(".sector-badge").textContent.trim()'), '+1.00');
    await evaluate('document.querySelector("button").click()');
    await until('document.querySelector(".industry-chart canvas")');
    await until('window.test.interests.some(item=>item.chart_codes.includes("sz002594"))');
    await evaluate('document.querySelector("select").value="01801880";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))');
    await until('document.querySelector(".industry-current").textContent.trim()==="+0.50"');
    await evaluate('document.querySelector("select").value="01801095";document.querySelector("select").dispatchEvent(new Event("change",{bubbles:true}))');
    await until('document.querySelector(".industry-current").textContent.trim()==="+1.00"');
    const screenshot = path.join(testDir, 'industry.png');
    fs.writeFileSync(screenshot, (await win.webContents.capturePage()).toPNG());

    await win.loadURL('about:blank');
    await win.loadFile(path.join(testDir, 'index.html'), { hash: 'settings' });
    await until('document.querySelector(".watch-float-industry-settings")');
    assert.equal(await evaluate('window.test.opens'), 0, 'settings must never query membership');
    assert.equal(await evaluate('window.test.interests.length'), 0, 'settings must not subscribe to market data');
    assert.equal(await evaluate('document.querySelectorAll(".watch-float-industry-row select")[1].disabled'), true);
    await evaluate('document.querySelector(".watch-float-industry-settings > label input").click()');
    await until('window.test.snapshot().config.watch_float.show_industry===false');
    await evaluate('document.querySelector(".watch-float-industry-row input").click()');
    await until('window.test.snapshot().stocks[0].config.industry.show_in_float===true');
    await evaluate('document.querySelector(".watch-float-industry-row select").value="01801880";document.querySelector(".watch-float-industry-row select").dispatchEvent(new Event("change",{bubbles:true}))');
    await until('window.test.snapshot().stocks[0].config.industry.selected_id==="01801880"');
    await until('document.querySelector(".watch-float-industry-row select").value==="01801880" && !document.querySelector(".watch-float-industry-settings > label input").checked && document.querySelector(".watch-float-industry-row input").checked');
    assert.equal(await evaluate('window.test.opens'), 0);
    assert.equal(await evaluate('window.test.interests.length'), 0);
    await new Promise(resolve => setTimeout(resolve, 100));
    fs.writeFileSync(path.join(testDir, 'settings.png'), (await win.webContents.capturePage()).toPNG());

    for (const hash of ['watch', 'float']) {
      await win.loadURL('about:blank');
      await win.loadFile(path.join(testDir, 'index.html'), { hash });
      await until(hash === 'watch' ? 'document.querySelector(".watch-float-row")' : 'document.querySelector(".float-widget")');
      assert.equal(await evaluate('window.test.opens'), 0, 'floating windows must never query membership');
      await evaluate('window.test.snapshot().stocks[0].config.industry.show_in_float=true;window.finBox.updateStockIndustry("sz002594",{})');
      await until('document.querySelector(".sector-badge.float")');
      assert.equal(await evaluate('document.querySelector(".sector-badge.float").textContent.trim()'), '+1.00');
      assert.equal(await evaluate(`(()=>{const badge=document.querySelector('.sector-badge.float');const parent=badge.parentElement;const before=badge.previousElementSibling;const a=before.getBoundingClientRect(),b=badge.getBoundingClientRect();const x=getComputedStyle(before),y=getComputedStyle(badge);return b.left>=a.right && Math.abs(b.top-a.top)<3 && x.fontFamily===y.fontFamily && x.fontSize===y.fontSize && x.fontWeight===y.fontWeight})()`), true, 'sector change must sit next to the stock change with matching typography');
      await until('window.test.interests.some(item=>item.codes.includes("sz002594"))');
      if (hash === 'watch') {
        await evaluate('window.finBox.updateWatchFloatConfig({show_industry:false})');
        await until('!document.querySelector(".sector-badge.float")');
        await until('window.test.interests[window.test.interests.length-1].codes.length===0');
        await evaluate('window.finBox.updateWatchFloatConfig({show_industry:true})');
        await until('document.querySelector(".sector-badge.float")');
      }
      fs.writeFileSync(path.join(testDir, hash + '.png'), (await win.webContents.capturePage()).toPNG());
    }
    assert.deepEqual(errors, []);
    console.log('PASS: 行业选择、显示开关、分时、自选列表、两类浮窗、配置页行业选择与总开关；无真实网络请求。');
    console.log('UI screenshots: ' + testDir);
    win.destroy(); app.exit(0);
  }).catch(error => { console.error(error); app.exit(1); });
}
