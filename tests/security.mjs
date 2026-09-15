import {createRequire} from 'node:module';import {readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),w=createRequire(require.resolve('wrangler/package.json'));const {Miniflare}=w('miniflare');const {build}=w('esbuild');
const bundle=await build({stdin:{contents:"import {handle} from './lib/vault-server.ts';export default {fetch:handle}",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
const worker=process.env.TEST_BUILT_WORKER?{modules:[{type:'ESModule',path:'dist/server/index.js'},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:'dist/server/'+p}))]}:{modules:true,script:bundle.outputFiles[0].text};
const mf=new Miniflare({...worker,compatibilityFlags:['nodejs_compat'],compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{SETUP_KEY:'test-setup-key'},cf:false});
let checks=0;const origin='https://vault.test';
async function req(path,{cookie='',method='GET',data,raw,headers={},expect=200}={}){const r=await mf.dispatchFetch(origin+'/api/vault/'+path,{method,headers:{origin,cookie,'cf-connecting-ip':'192.0.2.1',...(data?{'content-type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):raw});assert.equal(r.status,expect,`${method} ${path}: ${r.status} ${r.status!==expect?await r.text():''}`);checks++;return r}
const data=async(r)=>r.json(); const cookie=r=>r.headers.get('set-cookie')?.split(';')[0];
try{
 const db=await mf.getD1Database('DB');for(const sql of readFileSync('drizzle/0000_aromatic_ben_grimm.sql','utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
 assert.equal((await data(await req('status'))).needsSetup,true);
 await req('setup',{method:'POST',data:{key:'wrong'},expect:403});
 let r=await req('setup',{method:'POST',data:{key:'test-setup-key',name:'Owner',username:'owner',password:'owner-password-long'}}),owner=cookie(r);const ownerId=(await data(r)).user.id;
 await req('setup',{method:'POST',data:{key:'test-setup-key',name:'Second',username:'second',password:'owner-password-long'},expect:409});
 const people={};for(const [name,role] of [['alice','member'],['bob','member'],['admin','admin']]){await req('members',{cookie:owner,method:'POST',data:{name,username:name,password:'temporary-password',role}});r=await req('login',{method:'POST',data:{username:name,password:'temporary-password'}});let c=cookie(r);const u=(await data(r)).user;await req('media',{cookie:c,expect:403});r=await req('password',{cookie:c,method:'POST',data:{current:'temporary-password',password:name+'-permanent-password'}});const rotated=cookie(r);assert.ok(rotated&&rotated!==c);await req('me',{cookie:rotated});r=await req('login',{method:'POST',data:{username:name,password:name+'-permanent-password'}});people[name]={id:u.id,cookie:cookie(r)}}
 const a=people.alice,b=people.bob,ad=people.admin;
 for(const person of [a,ad]){const list=(await data(await req('members',{cookie:person.cookie}))).members;assert.ok(!list.some(m=>m.role==='owner'||m.id===ownerId));}
 assert.ok((await data(await req('members',{cookie:owner}))).members.some(m=>m.id===ownerId));
 await req('members/'+b.id+'/reset',{cookie:owner,method:'POST',headers:{'x-vault-user':a.id},data:{password:'not-applied-password'},expect:409});
 await req('me',{cookie:'theme=light;'+a.cookie+';other=value'});
 const otherSession=cookie(await req('login',{method:'POST',data:{username:'alice',password:'alice-permanent-password'}}));
 r=await req('password',{cookie:a.cookie,method:'POST',data:{current:'alice-permanent-password',password:'alice-updated-password'}});a.cookie=cookie(r);assert.ok(a.cookie);await req('me',{cookie:a.cookie});await req('me',{cookie:otherSession,expect:401});

 await req('members',{cookie:a.cookie,method:'POST',data:{},expect:403});
 await req('members/'+ownerId+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'new-password-long'},expect:403});
 await req('media?view=family',{cookie:ad.cookie,expect:403});
 await req('albums',{cookie:a.cookie,method:'POST',headers:{origin:'https://evil.test'},data:{name:'bad'},expect:403});
 await req('albums',{cookie:a.cookie,method:'POST',data:{name:'Holidays'}});const album=(await data(await req('albums',{cookie:a.cookie}))).albums[0].id;
 const bytes=Buffer.alloc(8*1024*1024+130,27);const upload=(await data(await req('uploads',{cookie:a.cookie,method:'POST',data:{name:'test.mp4',size:bytes.length,type:'video/mp4',album}}))).id;
 await req('media/'+upload+'/file',{cookie:a.cookie,expect:404});
 await req('uploads/'+upload+'/complete',{cookie:a.cookie,method:'POST',data:{},expect:400});
 for(let n=1;n<=2;n++){const raw=bytes.subarray((n-1)*8*1024*1024,n*8*1024*1024);if(n===2)await req('uploads/'+upload+'/part?part='+n,{cookie:a.cookie,method:'PUT',raw,headers:{'x-content-sha256':'wrong'},expect:400});await req('uploads/'+upload+'/part?part='+n,{cookie:a.cookie,method:'PUT',raw,headers:{'x-content-sha256':createHash('sha256').update(raw).digest('hex')}})}
 await req('uploads/'+upload+'/complete',{cookie:a.cookie,method:'POST',data:{}});
 assert.equal((await data(await req('media',{cookie:a.cookie}))).media.length,0);
 const object=await db.prepare('SELECT object_key FROM media WHERE id=?').bind(upload).first();const r2=await mf.getR2Bucket('BUCKET');await r2.put(object.object_key,Buffer.alloc(bytes.length,99));
 await req('uploads/'+upload+'/verify',{cookie:a.cookie,method:'POST',data:{part:1},expect:400});
 assert.equal((await data(await req('media',{cookie:a.cookie}))).media.length,0);await r2.put(object.object_key,bytes);
 await req('uploads/'+upload+'/verify',{cookie:a.cookie,method:'POST',data:{part:1}});
 assert.equal((await data(await req('media',{cookie:a.cookie}))).media.length,0);
 assert.equal((await data(await req('uploads/'+upload+'/verify',{cookie:a.cookie,method:'POST',data:{part:2}}))).verified,true);
 assert.equal((await data(await req('media',{cookie:a.cookie}))).media.length,1);
 assert.equal((await data(await req('media?view=family&member='+a.id,{cookie:owner}))).media.length,1);
 assert.equal((await data(await req('media?view=family&member='+b.id,{cookie:owner}))).media.length,0);
 await req('media?view=family&member='+a.id,{cookie:b.cookie,expect:403});
 await req('media?view=mine&member='+a.id,{cookie:b.cookie,expect:403});

 await req('media/'+upload+'/file',{expect:401});await req('media/'+upload+'/file',{cookie:b.cookie,expect:404});await req('media/'+upload+'/file',{cookie:ad.cookie,expect:404});
 r=await req('media/'+upload+'/file',{cookie:owner});assert.deepEqual(Buffer.from(await r.arrayBuffer()),bytes);
 r=await req('media/'+upload+'/file',{cookie:a.cookie,headers:{range:'bytes=11-31'},expect:206});assert.equal((await r.arrayBuffer()).byteLength,21);
 await req('media/'+upload+'/shares',{cookie:a.cookie,method:'POST',data:{recipients:[b.id]}});
 await req('media/'+upload+'/file',{cookie:b.cookie});await req('media/'+upload+'/trash',{cookie:b.cookie,method:'POST',data:{},expect:404});
 assert.equal((await data(await req('media?view=shared',{cookie:b.cookie}))).media.length,1);
 await req('media/'+upload+'/shares',{cookie:a.cookie,method:'POST',data:{recipients:[]}});await req('media/'+upload+'/file',{cookie:b.cookie,expect:404});
 await req('media/'+upload+'/trash',{cookie:a.cookie,method:'POST',data:{}});await req('media/'+upload+'/file',{cookie:a.cookie,expect:404});await req('media/'+upload+'/restore',{cookie:a.cookie,method:'POST',data:{}});await req('media/'+upload+'/file',{cookie:a.cookie});
 await req('members/'+b.id+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'new-temporary-password'}});await req('me',{cookie:b.cookie,expect:401});await req('login',{method:'POST',data:{username:'bob',password:'bob-permanent-password'},expect:401});
 await req('me',{cookie:ad.cookie});await req('me',{cookie:owner});
 const resetLogin=await req('login',{method:'POST',data:{username:'bob',password:'new-temporary-password'}});const resetCookie=cookie(resetLogin);assert.equal((await data(resetLogin)).user.mustChange,true);
 r=await req('password',{cookie:resetCookie,method:'POST',data:{current:'new-temporary-password',password:'bob-final-password'}});const finalCookie=cookie(r);assert.ok(finalCookie&&finalCookie!==resetCookie);await req('me',{cookie:finalCookie});await req('login',{method:'POST',data:{username:'bob',password:'bob-final-password'}});await req('media',{cookie:finalCookie});
 await req('members/'+b.id+'/reset',{cookie:owner,method:'POST',data:{password:'owner-reset-password'}});await req('me',{cookie:owner});await req('me',{cookie:resetCookie,expect:401});
 await req('members/'+a.id+'/access',{cookie:ad.cookie,method:'POST',data:{active:false}});await req('me',{cookie:a.cookie,expect:401});
 console.log(`PASS: ${checks} API checks covering owner setup, roles, CSRF, multi-part upload, read-back checksums, private access, range download, sharing/revocation, trash/restore, password reset and account disable.`);
}finally{await mf.dispose()}
