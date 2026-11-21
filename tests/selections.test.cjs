const fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),assert=require('node:assert/strict');
const app=fs.readFileSync(path.join(__dirname,'../static/app.js'),'utf8');
const context={state:{residues:new Map([
 [1,{id:1,chain:'A',segid:'PROA',resid:40,icode:'',name:'ALA'}],
 [2,{id:2,chain:'B',segid:'PROB',resid:40,icode:'',name:'GLY'}],
 [3,{id:3,chain:'A',segid:'PROA',resid:55,icode:'A',name:'LYS'}],
 [4,{id:4,chain:'A',segid:'PRO A',resid:-2,icode:'',name:'SER'}],
 [5,{id:5,chain:'',segid:'PROB',resid:90,icode:'',name:'LEU'}],
])}};
vm.createContext(context);vm.runInContext(fs.readFileSync(path.join(__dirname,'../static/selections.js'),'utf8'),context);
vm.runInContext(app.slice(app.indexOf('function selection('),app.indexOf('function applyHighlight(')),context);
const ids=text=>[...context.selection(text).ids].sort((a,b)=>a-b);
assert.deepEqual(ids('40'),[1,2]);assert.deepEqual(ids('A/PROA:40, PROB:90'),[1,5]);
assert.deepEqual(ids('segid PROA and resid 40:60'),[1,3]);
assert.deepEqual(ids('(chain A or chain B) and not resname GLY'),[1,3,4]);
assert.deepEqual(ids('chain B or chain A and resid 55A'),[2,3]);
assert.deepEqual(ids('segid "PRO A" and resid -5:-1'),[4]);
assert.deepEqual(ids('segid PRO? and not chain B'),[1,3,5]);
assert.deepEqual(ids('protein and not (resname GLY or resid 90)'),[1,3,4]);
assert.equal(context.selection('segid MISSING').unknown.length,1);
for(const text of ['segid PROA and', '(chain A', 'resid 60:40','chain A segid PROA','segid "broken'])assert.throws(()=>context.selection(text),undefined,text);
console.log('PASS: legacy qualifiers, Boolean precedence, negation, insertion codes, negative ranges, quoted segids, wildcards, and invalid syntax.');
