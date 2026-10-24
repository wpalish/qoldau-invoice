import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import definition from '../module.js';
import {WorkStore} from '../core/store.js';

test('Qoldau Invoice: protected source lines cannot escape into another draft',()=>{
  for(const protectedStatus of ["issued","cancelled"]){
    const dir=mkdtempSync(join(tmpdir(),'qoldau-invoice-protected-'));
    const database=join(dir,'workspace.sqlite');
    let store=new WorkStore(definition,database);
    const save=(collection,data,id)=>{
      const result=store.transact({operation:'save',collection,data,id,revision:store.read().revision});
      return id||result.data[collection].at(-1).id;
    };
    const assertRejected=(command)=>{
      const before=store.read(),events=store.db.prepare('SELECT count(*) n FROM audit').get().n;
      assert.throws(()=>store.transact({...command,revision:before.revision}),/черновик/);
      assert.deepEqual(store.read(),before,'Rejected relocation preserves both document totals, rows and revision.');
      assert.equal(store.db.prepare('SELECT count(*) n FROM audit').get().n,events,'No successful audit event on rejection.');
    };
    try{
      const client=save('clients',{name:'SYNTHETIC client',email:''});
      const doc=(number,status='draft')=>({number,client,currency:'KZT',due:'2099-12-31',status});
      const aData=doc('SYNTHETIC-PROTECTED'),bData=doc('SYNTHETIC-DRAFT');
      const a=save('invoices',aData),b=save('invoices',bData);
      const line=(invoice,description,price='100')=>({invoice,description,quantity:1,price});
      const first=save('lines',line(a,'SYNTHETIC protected line'));
      save('lines',line(a,'SYNTHETIC second line'));
      const free=save('lines',line(b,'SYNTHETIC free line','50'));
      save('lines',line(a,'SYNTHETIC free line','50'),free);
      save('lines',line(b,'SYNTHETIC free line','50'),free);
      save('invoices',{...aData,status:protectedStatus},a);
      store.close();store=new WorkStore(definition,database);
      assertRejected({operation:'save',collection:'lines',id:first,data:line(b,'SYNTHETIC protected line')});
      assertRejected({operation:'save',collection:'lines',id:first,data:line(b,'SYNTHETIC changed line','1')});
      assertRejected({operation:'save',collection:'lines',id:first,data:line(a,'SYNTHETIC protected line','1')});
      assertRejected({operation:'archive',collection:'lines',id:first});
      assertRejected({operation:'save',collection:'lines',id:free,data:line(a,'SYNTHETIC free line','50')});
      const restored=new WorkStore(definition);
      try{
        restored.restore(store.export());
        assert.deepEqual(restored.read().data,store.read().data,'Validated restore preserves protected history.');
        const before=restored.read();
        assert.throws(()=>restored.transact({operation:'save',collection:'lines',id:first,revision:before.revision,data:line(b,'SYNTHETIC protected line')}),/черновик/);
        assert.deepEqual(restored.read(),before);
      }finally{restored.close();}
      if(true){
        save('invoices',{...aData,status:'draft'},a);
        save('lines',line(b,'SYNTHETIC protected line'),first);
        assert.equal(store.read().data.lines.find(x=>x.id===first).invoice,b,'Explicit permitted return to draft allows editing again.');
      }
    }finally{store.close();rmSync(dir,{recursive:true,force:true});}
  }
});
