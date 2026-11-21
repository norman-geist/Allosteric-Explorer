const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const mech=fs.readFileSync(path.join(__dirname,'../static/mechanism.js'),'utf8');
const polish=fs.readFileSync(path.join(__dirname,'../static/polish.js'),'utf8');
class El {
 constructor(tag='div',text=''){this.tag=tag;this.textContent=text;this.children=[];this.dataset={};this._value='';this.checked=false;this.classList={toggle(){},remove(){}};}
 append(...nodes){for(const node of nodes){if(node.parent)node.parent.children=node.parent.children.filter(n=>n!==node);node.parent=this;this.children.push(node);}if(this.tag==='select'&&!this._value)this.value=this.children[0]?.value||'';}
 prepend(...nodes){this.children.unshift(...nodes);}
 replaceChildren(...nodes){this.children=[];this._value='';this.append(...nodes);}
 after(node){if(this.parent){const i=this.parent.children.indexOf(this);node.parent=this.parent;this.parent.children.splice(i+1,0,node);}}
 setAttribute(k,v){this[k]=v;} removeAttribute(k){delete this[k];} addEventListener(){} scrollIntoView(){}
 set value(v){this._value=String(v);}get value(){return this._value;}
 get options(){return this.children;} get rows(){return this.children;} get cells(){return this.children;}
 insertRow(){const row=new El('tr');row.insertCell=()=>{const cell=new El('td');row.append(cell);return cell;};this.append(row);return row;}
}
const fields=new Map(),$=id=>{if(!fields.has(id))fields.set(id,new El());return fields.get(id);};
const makePlot=()=>({card:new El('figure'),svg:new El('svg'),status:new El('figcaption'),addData(){},update(){},exportData(){}});
const state={structure:{name:'fixture.pdb'},residues:new Map([1,2,3,4].map(id=>[id,{id,chain:'A',segid:'PROA',resid:id,icode:'',name:'ALA'}])),pockets:[],highlighted:new Set(),communication:true,perturbation:false};
const ctx={state,$,document:{getElementById:$},element:(tag,text,cls)=>new El(tag,text),Option:function(text,v){const o=new El('option',text);o.value=v;o.text=text;return o;},qualifiedResidues:ids=>ids.map(id=>'A/PROA:'+id).join(', '),nameOf:id=>'A:'+id,number:v=>v==null?'—':String(v),resultsTable:()=>({table:new El('table'),body:new El('tbody')}),analysisSites:()=>[{name:'Region A',color:'#c445a0',ids:new Set([1])},{name:'Predicted pockets',color:'#576dca',ids:new Set()}],pocketMembership:()=>new Map(),residueSiteNames:()=>[],matrixPlot:makePlot,profilePlot:makePlot,scatterPlot:makePlot,svgNode:(tag,a,t)=>new El(tag,t),viewer:null,draw(){},downloadCsv(){},atob:s=>Buffer.from(s,'base64').toString('binary'),mechanism:{},plotCard:makePlot,axes:()=>({x:v=>v,y:v=>v,left:0,top:0,width:450,height:248,bottom:248}),indexTicks:()=>[],prsGroupOptions:()=>[],prsPocketPlot:()=>new El(),prsMaximum:()=>1,explorerVersion:'0.9b3'};
vm.createContext(ctx);
const plots=fs.readFileSync(path.join(__dirname,'../static/plots.js'),'utf8');
vm.runInContext(plots.slice(0,plots.indexOf('function svgNode(')),ctx);
vm.runInContext(polish.slice(polish.indexOf('function resultSection(')),ctx);
vm.runInContext(app.slice(app.indexOf('function renderResults('),app.indexOf('function clearWorkspace(')),ctx);
const row={id:2,coupling:.2,signed:-.1,distance:12,connected:false,edges:[],path:[]};
state.analyzed={frames:20,nodes:4,edges:0,settings:{a:[1],b:[],functional:[],method:'dcc',cutoff:8},rows:[row],profile:[row],pockets:[],sasa_frames:[],correlation:Buffer.alloc(4*4*4).toString('base64')};
ctx.renderResults();
function sequence(root){return root.children.flatMap(node=>node.dataset.resultKind ? [node.dataset.resultKind] : node.children.filter(n=>n.dataset.resultKind).map(n=>n.dataset.resultKind));}
assert.deepEqual(sequence($('results')),['summary','plots','tables','inspection']);
assert.equal(state.inspected,2);
assert.ok($('results').children.find(n=>n.dataset.resultKind==='inspection').children.some(n=>n.tag==='select'||n.children?.some(x=>x.tag==='select')));
state.analyzed.rows=[];ctx.renderResults();assert.deepEqual(sequence($('results')),['summary','plots','tables','inspection']);
vm.runInContext(mech.slice(mech.indexOf('function prsResponderRows('),mech.indexOf('function prsPocketPlot(')),ctx);
const result={sources:[1],targets:[2],response:[{id:1,score:null,distance:0},{id:2,score:.2,distance:4}],rows:[{id:1,score:.2,target_count:1}],cutoff:8,pair_scores:Buffer.from(new Float32Array([NaN,.2]).buffer).toString('base64')};
for(const workflow of ['responders','sources']){
 state.perturbation=true;ctx.renderPrs(result,{workflow,sourceName:'A:1',targetName:'A:2',targetRestricted:true,referenceName:'Loaded PDB',pocketSource:false});
 assert.deepEqual(sequence($('prsResults')),['summary','plots','tables','inspection']);
 assert.equal(typeof ctx.mechanism.inspectReceiver,'function');
}
console.log('PASS: actual Communication (including empty candidates) and both PRS result constructors use summary → plots → tables → inspection, retaining linked selection handlers.');
