const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
class Element {
 constructor(text=''){this.textContent=text;this.children=[];this.value='';this.listeners={};this.classes=new Set();this.classList={add:k=>this.classes.add(k),toggle:(k,on)=>{if(on)this.classes.add(k);else this.classes.delete(k);}};}
 append(...nodes){this.children.push(...nodes);}
 replaceChildren(...nodes){this.children=nodes;}
 setAttribute(k,v){this[k]=v;} removeAttribute(k){delete this[k];}
 addEventListener(k,fn){this.listeners[k]=fn;}
}
const fields=new Map(),get=id=>{if(!fields.has(id))fields.set(id,new Element());return fields.get(id);};
let observer,exported;
const context={document:{createElement:()=>new Element(),getElementById:get},MutationObserver:class{constructor(fn){observer=fn;}observe(){}},exportCsv:(rows)=>{exported=rows;},state:{structure:null,highlighted:new Set([1]),viewerPanel:'pockets',residues:new Map()},roleFields:{a:'roleA',b:'roleB',functional:'roleFunctional'},custom:{},mechanism:{},nodeOf:atom=>atom.id,qualifiedResidues:ids=>ids.join(','),renderCustom(){},clearResults(){},notice(){},clearPrsResults(){},applyHighlight(){context.state.highlighted=new Set(get('highlights').value.split(',').map(Number));},restyleFrame(){},conformationState:{}};
vm.createContext(context);
const src=fs.readFileSync(path.join(__dirname,'../static/polish.js'),'utf8');vm.runInContext(src.slice(0,src.indexOf('\n(() => {')),context);
const headers=[new Element('Residue'),new Element('Score')];
const body={rows:[],append(row){this.rows=this.rows.filter(r=>r!==row);this.rows.push(row);}};
function row(name,score){const r={cells:[new Element(name),new Element(score)],hidden:false,onclick(){}};Object.defineProperty(r,'textContent',{get(){return this.cells.map(c=>c.textContent).join(' ');}});return r;}
body.rows=[row('A:1','10'),row('A:2','2'),row('A:3','—')];
const caption=new Element();const table={createCaption:()=>caption,tHead:{rows:[{cells:headers}]},tBodies:[body],classList:{add(){}}};
context.enhanceResultsTable(table,['Residue','Score']);observer();
assert.ok(headers[1].classes.has('numeric-cell'));
assert.ok(body.rows.every(row=>row.cells[1].classes.has('numeric-cell')));
assert.ok(!headers[0].classes.has('numeric-cell'));
assert.ok(body.rows.every(row=>!row.cells[0].classes.has('numeric-cell')));
// Reclassification follows new contents and keeps the entire column aligned.
body.rows[0].cells[1].textContent='Not available';observer();
assert.ok(!headers[1].classes.has('numeric-cell'));
assert.ok(body.rows.every(row=>!row.cells[1].classes.has('numeric-cell')));
body.rows[0].cells[1].textContent='10';observer();
assert.ok(headers[1].classes.has('numeric-cell'));

headers[1].children[0].onclick();assert.deepEqual(body.rows.map(r=>r.cells[1].textContent),['2.000','10.000','—']);
headers[1].children[0].onclick();assert.deepEqual(body.rows.map(r=>r.cells[1].textContent),['10.000','2.000','—']);
const [filter,count,download]=caption.children[0].children;
filter.value='A:2';filter.listeners.input();assert.equal(body.rows.filter(r=>!r.hidden).length,1);assert.equal(count.textContent,'1 / 3 rows');
download.onclick();assert.equal(exported.length,2);assert.equal(exported[1][0],'A:2');
assert.equal(typeof body.rows[0].onclick,'function');
const line='HETATM    5  ZN   ZN A  99       4.000   1.000   0.000  1.00 20.00      METLZN';
const ions=context.pdbIons(line);assert.equal(ions.length,1);assert.equal(ions[0].name,'ZN');
get('showStructuralIons').checked=true;get('ionLabels').checked=true;
const scene={pdb:line,markers:[],labels:[]};context.addIonMarkers(scene);assert.equal(scene.markers.length,1);assert.equal(scene.labels.length,1);
context.state.structure={pdb:line};assert.equal(context.pocketIonDistances({centers:[[4,1,1]]}).length,1);assert.equal(context.pocketIonDistances({centers:[[40,1,1]]}).length,0);
get('showStructuralIons').checked=false;const hiddenScene={pdb:line,markers:[],labels:[]};context.addIonMarkers(hiddenScene);assert.equal(hiddenScene.markers.length,0);
let hover,unhover,click,removed=0;
const view={addLabel:()=>({}),removeLabel(){removed++;},render(){}};
context.installResidueInspection(view,{setHoverable(_sel,_yes,h,u){hover=h;unhover=u;},setClickable(_sel,_yes,c){click=c;}});
const atom={id:2,pdbline:'ATOM      2  CA  ALA A  40       4.000   1.000   0.000  1.00 20.00      PROA C',atom:'CA'};
hover(atom);unhover();assert.equal(removed,1);
get('pickAction').value='a';get('appendPick').checked=true;click(atom);
assert.equal(get('roleA').value,'custom');assert.equal(context.custom.a,'1,2');assert.ok(get('atomInspection').textContent.includes('segid PROA'));
get('appendPick').checked=false;get('pickAction').value='prs-source';click(atom);assert.equal(get('prsCustom').value,'2');assert.equal(get('prsScope').value,'custom');
get('pickAction').value='prs-target';click(atom);assert.equal(get('prsWorkflow').value,'sources');assert.equal(get('prsRankingFields').hidden,false);
console.log('PASS: numeric sort, missing values, filtering/table export, ion display/proximity, hover identity, accumulated/replaced region and PRS picks.');
