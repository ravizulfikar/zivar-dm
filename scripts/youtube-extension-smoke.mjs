import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { chromium } from '../.tools/browser-test/node_modules/playwright-core/index.mjs';
import { startServer } from '../app/server.mjs';
const root=path.resolve('tests/.tmp');const temp=await fs.mkdtemp(path.join(root,'youtube-extension-'));
const app=await startServer({port:0,dataDirectory:path.join(temp,'state'),downloadDirectory:path.resolve('artifacts/youtube-extension')});
let context;
try {
 const ext=path.join(temp,'extension');await fs.cp('extension',ext,{recursive:true});const p=path.join(ext,'background.js');await fs.writeFile(p,(await fs.readFile(p,'utf8')).replace("'http://127.0.0.1:18765'",JSON.stringify(app.origin)));
 context=await chromium.launchPersistentContext(path.join(temp,'profile'),{channel:'chromium',headless:true,args:[`--disable-extensions-except=${ext}`,`--load-extension=${ext}`]});
 const worker=context.serviceWorkers()[0]||await context.waitForEvent('serviceworker');await worker.evaluate(token=>chrome.storage.local.set({token}),app.token);
 const page=await context.newPage();
 await page.route('https://www.youtube.com/watch?**',r=>r.fulfill({contentType:'text/html',body:'<!doctype html><title>YouTube test</title><video controls autoplay muted style="width:800px;height:450px" ></video><script>const c=document.createElement("canvas");c.width=640;c.height=360;const g=c.getContext("2d");setInterval(()=>{g.fillStyle="gray";g.fillRect(0,0,640,360)},100);document.querySelector("video").srcObject=c.captureStream(10);</script>'}));
 await page.route('https://www.youtube.com/fixture.mp4',r=>r.fulfill({contentType:'video/mp4',path:path.resolve('artifacts/youtube-test/YouTube-Io0fBr1XBUA.mp4')}));
 // Record every overlay state so we can prove "not supported" never flashes while the extractor runs.
 await page.addInitScript(()=>{window.__zivarStates=[];setInterval(()=>{const s=document.querySelector('[data-zivar-video-panel]')?.dataset.zivarState;if(s&&window.__zivarStates.at(-1)!==s)window.__zivarStates.push(s);},50);});
 await page.goto('https://www.youtube.com/watch?v=Io0fBr1XBUA');
 await page.getByRole('button',{name:'ZIVAR sedang memeriksa video',exact:true}).waitFor({timeout:30000});
 await page.getByRole('button',{name:'Pilih media video ZIVAR',exact:true}).waitFor({timeout:180000});
 const states=await page.evaluate(()=>window.__zivarStates);assert.equal(states[0],'checking',states.join(','));assert.ok(!states.includes('unsupported'),states.join(','));
 await page.getByRole('button',{name:'Pilih media video ZIVAR',exact:true}).click();
 const choice=page.getByRole('button').filter({hasText:'144p'});await choice.click();

 const deadline=Date.now()+180000;while(!app.manager.jobs.some(j=>['completed','error'].includes(j.status))){if(Date.now()>deadline)throw new Error('Download timeout');await new Promise(r=>setTimeout(r,500));}
 assert.equal(app.manager.jobs[0].status,'completed',app.manager.jobs[0].error);assert.equal(app.manager.jobs[0].kind,'youtube');console.log('PASS: YouTube overlay quality selection sends real extractor job and produces MP4.');
} finally {await context?.close();await app.close();if(path.dirname(temp)!==root)throw new Error('Unsafe cleanup');await fs.rm(temp,{recursive:true,force:true});}
