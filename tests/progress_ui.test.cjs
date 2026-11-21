const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const elements=new Map(),$=id=>{if(!elements.has(id))elements.set(id,{textContent:'',hidden:true});return elements.get(id);};
let poll,resolveCalculation,cleared=false;const requests=[];
const state={token:'test-token',busy:false};
const context={state,$,FormData:class{},performance:{now:()=>1000},setInterval:fn=>{poll=fn;return 7;},clearInterval:id=>{assert.equal(id,7);cleared=true;},notice:text=>{$('notice').textContent=text||'';},controls(){},
 fetch:async(url,options)=>{requests.push({url,options});if(url.startsWith('/api/progress/'))return {ok:true,json:async()=>({status:'running',stage:'Reading retained trajectory frames',completed:30,total:100})};return new Promise(resolve=>{resolveCalculation=()=>resolve({ok:true,status:200,headers:{get:()=> 'application/json'},json:async()=>({frames:100})});});}};
vm.createContext(context);vm.runInContext(source.slice(source.indexOf('async function api('),source.indexOf('function requestedCpuWorkers(')),context);
(async()=>{
 const task=context.task('Starting calculation',()=>context.api('/api/communication',{}));
 assert.ok(state.activeJob);assert.equal(state.busy,true);assert.equal($('taskProgress').hidden,false);
 assert.equal(requests[0].options.headers['X-Explorer-Job'],state.activeJob);
 await poll();assert.equal($('notice').textContent,'Reading retained trajectory frames · 30/100');
 assert.equal(requests.at(-1).options.headers['X-Explorer-Token'],'test-token');
 resolveCalculation();await task;assert.equal(state.busy,false);assert.equal(state.activeJob,null);assert.equal($('taskProgress').hidden,true);assert.ok(cleared);
 console.log('PASS: real task/API progress polling sends authenticated job IDs, displays stage counters, and cleans up after completion.');
})().catch(e=>{console.error(e);process.exitCode=1;});
