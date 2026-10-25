/** Diagnostic visual capture. Uses the shipped High preset with adaptive scaling off. */
import {_electron as electron} from '@playwright/test';
import {mkdir,writeFile,readFile,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import assert from 'node:assert/strict';
const root=resolve(import.meta.dirname,'..');
const version=JSON.parse(await readFile(join(root,'package.json'),'utf8')).version;
const folder=join(root,'test-results',`visual-${version}`),docs=join(root,'docs','validation');
await mkdir(folder,{recursive:true});await mkdir(docs,{recursive:true});
const app=await electron.launch({
  args:[join(root,'electron','main.cjs'),'--diagnostics',...(process.env.ETERNAL_TEST_NO_SANDBOX==='1'?['--no-sandbox']:[]),'--disable-dev-shm-usage','--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'],
  env:{...process.env,XDG_CONFIG_HOME:'/tmp/eternal-visual-config',XDG_CACHE_HOME:'/tmp/eternal-visual-cache'},timeout:60000,
});
const errors=[];
async function frameMetrics(page){
  return page.evaluate(()=>new Promise(resolve=>{
    const g=window.__game,r=g.renderer;r.info.autoReset=false;
    requestAnimationFrame(()=>{r.info.reset();requestAnimationFrame(()=>{
      resolve({quality:g.quality,hour:g.atmosphere.hour,pixelRatio:r.getPixelRatio(),canvas:{width:r.domElement.width,height:r.domElement.height},calls:r.info.render.calls,triangles:r.info.render.triangles,points:r.info.render.points,memory:{...r.info.memory},sunIntensity:g.sun?.intensity,phase:g.phase});
      r.info.autoReset=true;
    });});
  }));
}
try{
  const page=await app.firstWindow();page.on('pageerror',e=>errors.push(e.message));page.on('console',m=>{if(m.type()==='error')errors.push(m.text());});
  await page.waitForFunction(()=>!!window.__game,undefined,{timeout:60000});
  await page.evaluate(()=>{const g=window.__game;if(g.settings.value.adaptiveQuality)g.action('adaptiveQuality');g.action('quality',2);g.time=0;});
  const captures={menu:await frameMetrics(page)};
  await page.screenshot({path:join(folder,'high-menu.png')});
  await page.getByRole('button',{name:'Begin your journey',exact:true}).click();
  await page.waitForFunction(()=>window.__game.phase==='playing'&&window.__game.input.active);
  captures.golden=await frameMetrics(page);await page.screenshot({path:join(folder,'high-golden-gameplay.png')});
  await page.evaluate(()=>{window.__game.time=300;});captures.night=await frameMetrics(page);await page.screenshot({path:join(folder,'high-night.png')});
  await page.evaluate(()=>{window.__game.time=600;});captures.dawn=await frameMetrics(page);await page.screenshot({path:join(folder,'high-dawn.png')});
  assert.deepEqual(errors,[],'Visual scenarios must have no renderer errors');
  const report={version,renderer:'SwiftShader; actual shipped High preset at reported pixel ratio; adaptive resolution disabled; not a hardware FPS benchmark',captures,rendererErrors:errors};
  await writeFile(join(folder,'report.json'),JSON.stringify(report,null,2));
  await cp(join(folder,'high-golden-gameplay.png'),join(docs,'ultra-golden-gameplay.png'));
  await cp(join(folder,'high-night.png'),join(docs,'ultra-night.png'));
  await cp(join(folder,'report.json'),join(docs,'ultra-visual-results.json'));
  console.log(JSON.stringify(report,null,2));
}finally{await app.close();}
