import {createRequire} from 'node:module';import {readFileSync,readdirSync} from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';
const require=createRequire(import.meta.url),w=createRequire(require.resolve('wrangler/package.json'));const {Miniflare}=w('miniflare');const {build}=w('esbuild');
const bundle=await build({stdin:{contents:"import {handle} from './lib/vault-server.ts';export default {fetch:handle}",resolveDir:process.cwd()},bundle:true,write:false,format:'esm',platform:'neutral',external:['cloudflare:workers']});
const worker=process.env.TEST_BUILT_WORKER?{modules:[{type:'ESModule',path:'dist/server/index.js'},...readdirSync('dist/server',{recursive:true}).filter(p=>p.endsWith('.js')&&p!=='index.js').map(p=>({type:'ESModule',path:'dist/server/'+p}))]}:{modules:true,script:bundle.outputFiles[0].text};
const recoverySecret='test-recovery-key-at-least-32-characters';
const options={...worker,compatibilityFlags:['nodejs_compat'],compatibilityDate:'2026-05-15',d1Databases:['DB'],r2Buckets:['BUCKET'],bindings:{SETUP_KEY:'test-setup-key',reset_secret:recoverySecret},cf:false};
const mf=new Miniflare(options);
let checks=0;const origin='https://vault.test';
async function req(path,{cookie='',method='GET',data,raw,headers={},expect=200}={}){const r=await mf.dispatchFetch(origin+'/api/vault/'+path,{method,headers:{origin,cookie,'cf-connecting-ip':'192.0.2.1',...(data?{'content-type':'application/json'}:{}),...headers},body:data?JSON.stringify(data):raw});assert.equal(r.status,expect,`${method} ${path}: ${r.status} ${r.status!==expect?await r.text():''}`);checks++;return r}
const data=async(r)=>r.json(); const cookie=r=>r.headers.get('set-cookie')?.split(';')[0];
try{
 const db=await mf.getD1Database('DB');for(const file of readdirSync('drizzle').filter(f=>f.endsWith('.sql')).sort())for(const sql of readFileSync('drizzle/'+file,'utf8').split('--> statement-breakpoint'))if(sql.trim())await db.prepare(sql.trim()).run();
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
 // Account Center and all-role recovery.
 const answers=[{question:'birthday',answer:'1980-03-05'},{question:'wedding',answer:'  Secret   Garden '},{question:'oldest_child',answer:'Bluebird'}];
 const recovery=(username,submitted=answers,extra={})=>req('forgot-password',{method:'POST',data:{username,answers:submitted,password:'recovered-password-long',confirm:'recovered-password-long'},headers:{'cf-connecting-ip':'192.0.2.50'},...extra});
 const clearRecoveryLimits=()=>db.prepare("DELETE FROM limits WHERE key LIKE 'recovery-%'").run();
 await req('owner-reset',{method:'POST',data:{key:recoverySecret,password:'unused-password',confirm:'unused-password'},expect:404});
 await req('account',{expect:401});
 await req('members/'+a.id+'/access',{cookie:owner,method:'POST',data:{active:true}});
 a.cookie=cookie(await req('login',{method:'POST',data:{username:'alice',password:'alice-updated-password'}}));
 let profileResult=await data(await req('account/profile',{cookie:a.cookie,method:'POST',data:{name:'Alice Example',id:ownerId,role:'owner'}}));
 assert.equal(profileResult.user.id,a.id);assert.equal(profileResult.user.role,'member');assert.equal(profileResult.user.name,'Alice Example');
 assert.equal((await data(await req('me',{cookie:owner}))).user.name,'Owner');
 await req('account/profile',{cookie:a.cookie,method:'POST',data:{name:'   '},expect:400});
 await req('account/recovery',{cookie:a.cookie,method:'POST',data:{current:'wrong',answers},expect:400});
 await req('account/recovery',{cookie:a.cookie,method:'POST',data:{current:'alice-updated-password',answers:[answers[0],answers[0],answers[2]]},expect:400});
 await req('account/recovery',{cookie:a.cookie,method:'POST',headers:{origin:'https://evil.test'},data:{current:'alice-updated-password',answers},expect:403});
 const peopleToRecover=[{username:'owner',id:ownerId,cookie:owner,password:'owner-password-long'},{username:'admin',...ad,password:'admin-permanent-password'},{username:'alice',...a,password:'alice-updated-password'}];
 for(const person of peopleToRecover){
  assert.deepEqual((await data(await req('account',{cookie:person.cookie}))).recoveryQuestions,[]);
  await req('account/recovery',{cookie:person.cookie,method:'POST',data:{current:person.password,answers,user_id:b.id}});
  const account=await data(await req('account',{cookie:person.cookie}));assert.deepEqual(account.recoveryQuestions,answers.map(a=>a.question));assert.ok(!JSON.stringify(account).includes('Bluebird'));
  const record=await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+person.id).first();assert.ok(!record.value.includes('1980-03-05'));assert.ok(!record.value.includes('Bluebird'));
 }
 assert.equal(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+b.id).first(),null);
 const badAnswers=answers.map((a,i)=>i===1?{...a,answer:'Incorrect'}:a);
 const unknown=await data(await recovery('nobody',answers,{expect:400}));
 assert.deepEqual(await data(await recovery('bob',answers,{expect:400})),unknown);
 assert.deepEqual(await data(await recovery('owner',badAnswers,{expect:400})),unknown);
 await recovery('owner',answers,{headers:{origin:'https://evil.test'},expect:403});
 await recovery('owner',answers,{data:{username:'owner',answers,password:'new-password-long',confirm:'different-password'},expect:400});
 await clearRecoveryLimits();
 // Simulated storage failure must preserve the original password and sessions.
 await db.prepare("CREATE TRIGGER fail_recovery BEFORE UPDATE ON users WHEN OLD.role='owner' BEGIN SELECT RAISE(ABORT, 'simulated storage failure'); END").run();
 await recovery('owner',answers,{expect:503});await req('me',{cookie:owner});
 await db.prepare('DROP TRIGGER fail_recovery').run();
 await db.prepare('INSERT INTO limits(key,count,reset) VALUES(?,?,?) ON CONFLICT(key) DO UPDATE SET count=excluded.count,reset=excluded.reset').bind('user:owner',12,Date.now()+900000).run();
 await req('login',{method:'POST',data:{username:'owner',password:'owner-password-long'},expect:429});
 for(const person of peopleToRecover){
  // Question order and case/extra spaces do not change the answers.
  const normalized=[...answers].reverse().map(a=>({...a,answer:a.answer.toUpperCase()}));
  await recovery(person.username,normalized);
  await req('me',{cookie:person.cookie,expect:401});
  await req('login',{method:'POST',data:{username:person.username,password:person.password},expect:401});
  person.cookie=cookie(await req('login',{method:'POST',data:{username:person.username,password:'recovered-password-long'}}));
  assert.equal((await data(await req('me',{cookie:person.cookie}))).user.mustChange,false);
 }
 owner=peopleToRecover[0].cookie;ad.cookie=peopleToRecover[1].cookie;a.cookie=peopleToRecover[2].cookie;
 // Disabled accounts cannot be re-enabled by recovery, even with correct answers.
 await req('members/'+a.id+'/access',{cookie:owner,method:'POST',data:{active:false}});
 assert.deepEqual(await data(await recovery('alice',answers,{expect:400})),unknown);
 await req('members/'+a.id+'/access',{cookie:owner,method:'POST',data:{active:true}});
 a.cookie=cookie(await req('login',{method:'POST',data:{username:'alice',password:'recovered-password-long'}}));
 // Removing/replacing questions requires the account's current password.
 await req('account/recovery',{cookie:a.cookie,method:'DELETE',data:{current:'wrong'},expect:400});
 await req('account/recovery',{cookie:a.cookie,method:'DELETE',data:{current:'recovered-password-long'}});
 assert.deepEqual((await data(await req('account',{cookie:a.cookie}))).recoveryQuestions,[]);
 await recovery('alice',answers,{expect:400});
 await req('account/recovery',{cookie:a.cookie,method:'POST',data:{current:'recovered-password-long',answers}});
 // Admin password reset removes the old recovery answers so they cannot bypass it.
 await req('members/'+a.id+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'admin-issued-temporary'}});
 assert.equal(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+a.id).first(),null);
 await clearRecoveryLimits();await recovery('alice',answers,{expect:400});
 const temp=cookie(await req('login',{method:'POST',data:{username:'alice',password:'admin-issued-temporary'}}));
 await req('account/recovery',{cookie:temp,method:'POST',data:{current:'admin-issued-temporary',answers},expect:403});
 // Answer checks are limited per username even when requests come from different IPs.
 for(let i=0;i<6;i++)await recovery('rate-limited-account',badAnswers,{expect:i<5?400:429,headers:{'cf-connecting-ip':'192.0.2.'+(70+i)}});
 // IP throttling also applies across different usernames.
 for(let i=0;i<16;i++)await recovery('rate-account-'+i,badAnswers,{expect:i<15?400:429,headers:{'cf-connecting-ip':'192.0.2.99'}});
 // Editable usernames preserve identity and recovery; confirmation and uniqueness are enforced.
 const otherOwnerSession=cookie(await req('login',{method:'POST',data:{username:'owner',password:'recovered-password-long'}}));
 const editOwner=(username,current='recovered-password-long',expect=200)=>req('account/profile',{cookie:owner,method:'POST',data:{name:'Updated Owner',username,current},expect});
 await editOwner('owner-renamed','wrong',400);
 await editOwner('bad username','recovered-password-long',400);
 await editOwner('ADMIN','recovered-password-long',409);
 assert.equal((await data(await req('me',{cookie:owner}))).user.name,'Owner');
 const edited=await data(await editOwner('Owner-Renamed'));
 assert.equal(edited.user.username,'owner-renamed');assert.equal(edited.user.id,ownerId);assert.equal(edited.user.role,'owner');
 await req('me',{cookie:otherOwnerSession,expect:401});
 assert.equal((await data(await req('me',{cookie:owner}))).user.username,'owner-renamed');
 await req('login',{method:'POST',data:{username:'owner',password:'recovered-password-long'},expect:401});
 await req('login',{method:'POST',data:{username:'owner-renamed',password:'recovered-password-long'}});
 assert.equal((await data(await req('account',{cookie:owner}))).recoveryQuestions.length,3);
 await clearRecoveryLimits();await recovery('owner-renamed');
 owner=cookie(await req('login',{method:'POST',data:{username:'owner-renamed',password:'recovered-password-long'}}));
 // Administrators choose forced or direct sign-in on reset; old sessions and recovery are still revoked.
 await req('members/'+a.id+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'optional-change-password',mustChange:'false'},expect:400});
 await req('members/'+a.id+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'optional-change-password',mustChange:false}});
 const noForce=await req('login',{method:'POST',data:{username:'alice',password:'optional-change-password'}}),noForceCookie=cookie(noForce);
 assert.equal((await data(noForce)).user.mustChange,false);await req('media',{cookie:noForceCookie});
 await req('account/recovery',{cookie:noForceCookie,method:'POST',data:{current:'optional-change-password',answers}});
 await req('members/'+a.id+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'required-change-password',mustChange:true}});
 await req('me',{cookie:noForceCookie,expect:401});
 assert.equal(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+a.id).first(),null);
 const forced=await req('login',{method:'POST',data:{username:'alice',password:'required-change-password'}}),forcedCookie=cookie(forced);
 assert.equal((await data(forced)).user.mustChange,true);await req('media',{cookie:forcedCookie,expect:403});
 await req('members/'+ownerId+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'not-allowed-password',mustChange:false},expect:403});
 await req('members/'+ad.id+'/reset',{cookie:ad.cookie,method:'POST',data:{password:'not-allowed-password',mustChange:false},expect:403});
 await req('members/'+ad.id+'/reset',{cookie:owner,method:'POST',data:{password:'owner-updated-admin',mustChange:false}});
 const adminReset=await data(await req('login',{method:'POST',data:{username:'admin',password:'owner-updated-admin'}}));assert.equal(adminReset.user.mustChange,false);
 // The same choice is available during account creation, with the secure default retained.
 await req('members',{cookie:owner,method:'POST',data:{name:'Direct',username:'direct',password:'direct-login-password',mustChange:false}});
 const direct=await req('login',{method:'POST',data:{username:'direct',password:'direct-login-password'}}),directCookie=cookie(direct);
 assert.equal((await data(direct)).user.mustChange,false);await req('account',{cookie:directCookie});
 await req('members/'+b.id+'/reset',{cookie:directCookie,method:'POST',data:{password:'not-allowed-password',mustChange:false},expect:403});
 // Admin-managed roles never grant the primary admin's media access.
 ad.cookie=cookie(await req('login',{method:'POST',data:{username:'admin',password:'owner-updated-admin'}}));
 const changeRole=(target,role,actor=ad.cookie,expect=200)=>req('members/'+target+'/role',{cookie:actor,method:'POST',data:{role},expect});
 await changeRole(b.id,'admin',directCookie,403);
 await changeRole(ownerId,'member',ad.cookie,403);
 await changeRole(ad.id,'member',ad.cookie,403);
 await changeRole(b.id,'owner',ad.cookie,400);
 await req('members',{cookie:ad.cookie,method:'POST',data:{username:'forbidden-owner',password:'not-allowed-password',role:'owner'},expect:400});
 await req('members/'+b.id+'/reset',{cookie:owner,method:'POST',data:{password:'role-test-password-long',mustChange:false}});
 const beforeRole=cookie(await req('login',{method:'POST',data:{username:'bob',password:'role-test-password-long'}}));
 await changeRole(b.id,'admin');await req('me',{cookie:beforeRole,expect:401});
 const promoted=await req('login',{method:'POST',data:{username:'bob',password:'role-test-password-long'}}),promotedCookie=cookie(promoted);
 assert.equal((await data(promoted)).user.role,'admin');
 await req('media?view=family',{cookie:promotedCookie,expect:403});
 assert.equal((await data(await req('media',{cookie:promotedCookie}))).media.length,0);
 await req('media/'+upload+'/file',{cookie:promotedCookie,expect:404});
 await req('media/'+upload+'/thumbnail',{cookie:promotedCookie,expect:404});
 await req('media/'+upload+'/shares',{cookie:promotedCookie,expect:404});
 assert.ok(!(await data(await req('members',{cookie:promotedCookie}))).members.some(m=>m.role==='owner'));
 await req('media/'+upload+'/shares',{cookie:owner,method:'POST',data:{recipients:[b.id]}});
 await req('media/'+upload+'/file',{cookie:promotedCookie});
 await req('media/'+upload+'/trash',{cookie:promotedCookie,method:'POST',data:{},expect:404});
 await req('media/'+upload+'/shares',{cookie:owner,method:'POST',data:{recipients:[]}});
 await req('media/'+upload+'/file',{cookie:promotedCookie,expect:404});
 await changeRole(b.id,'member');await req('me',{cookie:promotedCookie,expect:401});
 const demoted=await req('login',{method:'POST',data:{username:'bob',password:'role-test-password-long'}}),demotedCookie=cookie(demoted);
 assert.equal((await data(demoted)).user.role,'member');await changeRole(a.id,'admin',demotedCookie,403);
 await req('members',{cookie:ad.cookie,method:'POST',data:{name:'New Admin',username:'new-admin',password:'new-admin-password',role:'admin',mustChange:false}});
 const newAdmin=await data(await req('login',{method:'POST',data:{username:'new-admin',password:'new-admin-password'}}));assert.equal(newAdmin.user.role,'admin');
 await changeRole(ad.id,'member',owner);await req('me',{cookie:ad.cookie,expect:401});
 assert.equal((await data(await req('me',{cookie:owner}))).user.role,'owner');
 await req('media/'+upload+'/file',{cookie:owner});
 // Public signup is controlled only by the primary admin and defaults closed.
 assert.equal((await data(await req('status'))).signupEnabled,false);
 const publicAdmin=cookie(await req('login',{method:'POST',data:{username:'new-admin',password:'new-admin-password'}}));
 await req('signup-settings',{expect:401});await req('signup-settings',{cookie:publicAdmin,expect:403});
 await req('signup-settings',{cookie:publicAdmin,method:'POST',data:{enabled:true},expect:403});
 await req('signup-settings',{cookie:directCookie,method:'POST',data:{enabled:true},expect:403});
 assert.equal((await data(await req('signup-settings',{cookie:owner}))).enabled,false);
 let signupIp=110;
 const signup=(body,expect=200,headers={})=>req('signup',{method:'POST',data:body,expect,headers:{'cf-connecting-ip':'192.0.2.'+(signupIp++),...headers}});
 const applicant={name:'Public Member',username:'public-member',password:'12345678',confirm:'12345678'};
 await signup(applicant,403);
 await req('signup-settings',{cookie:owner,method:'POST',data:{enabled:'true'},expect:400});
 await req('signup-settings',{cookie:owner,method:'POST',data:{enabled:true},headers:{origin:'https://evil.test'},expect:403});
 await req('signup-settings',{cookie:owner,method:'POST',data:{enabled:true}});
 assert.equal((await data(await req('status'))).signupEnabled,true);
 await signup({...applicant,password:'1234567',confirm:'1234567'},400);
 await signup({...applicant,confirm:'different'},400);
 await signup({...applicant,username:'bad username'},400);
 await signup(applicant,403,{origin:'https://evil.test'});
 const registered=await signup({...applicant,role:'owner',mustChange:true,active:false}),registeredCookie=cookie(registered),registeredUser=(await data(registered)).user;
 assert.equal(registeredUser.role,'member');assert.equal(registeredUser.mustChange,false);assert.equal(registeredUser.active,true);
 assert.equal((await data(await req('media',{cookie:registeredCookie}))).media.length,0);
 await req('media?view=family',{cookie:registeredCookie,expect:403});
 await req('media/'+upload+'/file',{cookie:registeredCookie,expect:404});
 await signup({...applicant,username:'PUBLIC-MEMBER'},409);
 assert.ok(!(await data(await req('members',{cookie:registeredCookie}))).members.some(m=>m.role==='owner'));
 // The 8-character minimum also applies to personal changes, admin resets and recovery.
 await req('password',{cookie:registeredCookie,method:'POST',data:{current:'12345678',password:'1234567'},expect:400});
 let changed=await req('password',{cookie:registeredCookie,method:'POST',data:{current:'12345678',password:'abcdefgh'}}),changedCookie=cookie(changed);
 await req('account/recovery',{cookie:changedCookie,method:'POST',data:{current:'abcdefgh',answers}});
 await req('forgot-password',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.180'},data:{username:'public-member',answers,password:'87654321',confirm:'87654321'}});
 await req('login',{method:'POST',data:{username:'public-member',password:'87654321'}});
 await req('members/'+registeredUser.id+'/reset',{cookie:owner,method:'POST',data:{password:'abcd1234',mustChange:false}});
 await req('login',{method:'POST',data:{username:'public-member',password:'abcd1234'}});
 await req('members',{cookie:owner,method:'POST',data:{username:'eight-char',name:'Eight',password:'abcd1234',mustChange:false}});
 // Closing signup rejects direct requests from stale forms but preserves created users.
 await req('signup-settings',{cookie:owner,method:'POST',data:{enabled:false}});
 assert.equal((await data(await req('status'))).signupEnabled,false);
 await signup({...applicant,username:'closed-form'},403);
 await req('login',{method:'POST',data:{username:'public-member',password:'abcd1234'}});
 assert.equal(await db.prepare('SELECT id FROM users WHERE username=?').bind('closed-form').first(),null);
 await req('signup-settings',{cookie:owner,method:'POST',data:{enabled:true}});
 for(let i=0;i<6;i++)await signup({...applicant,username:'invalid username'},i<5?400:429,{'cf-connecting-ip':'192.0.2.199'});
 await req('signup-settings',{cookie:owner,method:'POST',data:{enabled:false}});
 // Full Primary admin editor: permissions, atomic validation and opaque recovery hashes.
 await req('members',{cookie:owner,method:'POST',data:{username:'doomed',name:'Before Edit',role:'admin',password:'initial-password',mustChange:false}});
 const logDoomed=(username,password)=>req('login',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.207'},data:{username,password}});
 const doomedLogin=await logDoomed('doomed','initial-password'),doomedCookie=cookie(doomedLogin),doomed=(await data(doomedLogin)).user;
 const managePath='members/'+doomed.id+'/manage',deletePath='members/'+doomed.id+'/delete';
 const editPayload={name:'After Edit',username:'doomed-renamed',role:'member',active:true,mustChange:false,recoveryAction:'keep'};
 for(const actor of [publicAdmin,directCookie]){
  await req(managePath,{cookie:actor,expect:403});
  await req(managePath,{cookie:actor,method:'POST',data:editPayload,expect:403});
  await req(deletePath,{cookie:actor,method:'POST',data:{confirmUsername:'doomed'},expect:403});
 }
 await req(managePath,{expect:401});
 await req('members/'+ownerId+'/manage',{cookie:owner,expect:403});
 await req('members/'+ownerId+'/delete',{cookie:owner,method:'POST',data:{confirmUsername:'owner-renamed'},expect:403});
 await req(managePath,{cookie:owner,method:'POST',headers:{origin:'https://evil.test'},data:editPayload,expect:403});
 await req('account/recovery',{cookie:doomedCookie,method:'POST',data:{current:'initial-password',answers}});
 const originalRecovery=await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+doomed.id).first();
 const privateView=await data(await req(managePath,{cookie:owner}));assert.equal(privateView.user.id,doomed.id);assert.deepEqual(privateView.recoveryQuestions,answers.map(a=>a.question));assert.ok(!JSON.stringify(privateView).includes('hash'));assert.ok(!JSON.stringify(privateView).includes('password'));assert.ok(!JSON.stringify(privateView).includes('Bluebird'));
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,username:'OWNER-RENAMED',recoveryAction:'clear'},expect:409});
 assert.equal((await data(await req('me',{cookie:doomedCookie}))).user.name,'Before Edit');
 assert.deepEqual(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+doomed.id).first(),originalRecovery);
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,role:'owner'},expect:400});
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,recoveryAction:'replace',answers:[answers[0],answers[0],answers[2]]},expect:400});
 await req(managePath,{cookie:owner,method:'POST',data:editPayload});
 await req('me',{cookie:doomedCookie,expect:401});
 let managedCookie=cookie(await logDoomed('doomed-renamed','initial-password'));
 assert.deepEqual(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+doomed.id).first(),originalRecovery);
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,password:'new-pass',confirm:'mismatch'},expect:400});
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,password:'new-pass',confirm:'new-pass',mustChange:true}});
 assert.equal(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+doomed.id).first(),null);
 const forcedManaged=await logDoomed('doomed-renamed','new-pass');assert.equal((await data(forcedManaged)).user.mustChange,true);
 const replacement=answers.map(a=>({...a,answer:'Private '+a.answer}));
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,recoveryAction:'replace',answers:replacement}});
 await req('forgot-password',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.208'},data:{username:'doomed-renamed',answers:replacement,password:'final-pass',confirm:'final-pass'}});
 await req(managePath,{cookie:owner,method:'POST',data:{...editPayload,active:false}});
 await req('login',{method:'POST',headers:{'cf-connecting-ip':'192.0.2.207'},data:{username:'doomed-renamed',password:'final-pass'},expect:401});
 await req(managePath,{cookie:owner,method:'POST',data:editPayload});managedCookie=cookie(await logDoomed('doomed-renamed','final-pass'));
 // Actual verified upload, thumbnail, unfinished multipart upload, and >1 deletion batch.
 await req('albums',{cookie:managedCookie,method:'POST',data:{name:'Deletion test'}});
 const doomedAlbum=(await data(await req('albums',{cookie:managedCookie}))).albums[0].id;
 const jpeg=Buffer.from([255,216,255,217]);
 const photo=(await data(await req('uploads',{cookie:managedCookie,method:'POST',data:{name:'owned.jpg',type:'image/jpeg',size:jpeg.length,album:doomedAlbum}}))).id;
 await req('uploads/'+photo+'/part?part=1',{cookie:managedCookie,method:'PUT',raw:jpeg,headers:{'x-content-sha256':createHash('sha256').update(jpeg).digest('hex')}});
 await req('uploads/'+photo+'/complete',{cookie:managedCookie,method:'POST',data:{}});await req('uploads/'+photo+'/verify',{cookie:managedCookie,method:'POST',data:{part:1}});
 await req('media/'+photo+'/thumbnail',{cookie:managedCookie,method:'PUT',raw:jpeg});
 await req('media/'+photo+'/shares',{cookie:managedCookie,method:'POST',data:{recipients:[b.id]}});
 await req('media/'+upload+'/shares',{cookie:owner,method:'POST',data:{recipients:[doomed.id]}});
 const pending=(await data(await req('uploads',{cookie:managedCookie,method:'POST',data:{name:'pending.jpg',type:'image/jpeg',size:jpeg.length}}))).id;
 await req('uploads/'+pending+'/part?part=1',{cookie:managedCookie,method:'PUT',raw:jpeg,headers:{'x-content-sha256':createHash('sha256').update(jpeg).digest('hex')}});
 const pendingRecord=await db.prepare('SELECT object_key,upload_id FROM media WHERE id=?').bind(pending).first();
 for(let i=0;i<24;i++){
  const mid='delete-fixture-'+i,key=doomed.id+'/'+mid;
  await r2.put(key,jpeg);
  await db.prepare("INSERT INTO media(id,owner,name,type,size,object_key,status,created,deleted) VALUES(?,?,?,'image/jpeg',4,?,'ready',?,?)").bind(mid,doomed.id,'fixture.jpg',key,Date.now(),i%2?Date.now():null).run();
 }
 await r2.put(doomed.id+'/untracked-thumb',jpeg);
 const siblingPrefix=doomed.id+'-other/sentinel';await r2.put(siblingPrefix,jpeg);
 await req(deletePath,{cookie:owner,method:'POST',data:{confirmUsername:'wrong'},expect:400});
 await req(deletePath,{cookie:owner,method:'POST',headers:{origin:'https://evil.test'},data:{confirmUsername:'doomed-renamed'},expect:403});
 assert.equal((await data(await req('me',{cookie:managedCookie}))).user.active,true);
 const deleteNext=()=>req(deletePath,{cookie:owner,method:'POST',data:{confirmUsername:'doomed-renamed'}});
 // Fail after storage deletion; database rows must remain available for a retry.
 await db.prepare("CREATE TRIGGER fail_delete_test BEFORE DELETE ON media WHEN OLD.owner IN(SELECT id FROM users WHERE username='doomed-renamed') BEGIN SELECT RAISE(ABORT,'simulated deletion failure'); END").run();
 await req(deletePath,{cookie:owner,method:'POST',data:{confirmUsername:'doomed-renamed'},expect:503});
 assert.equal((await db.prepare('SELECT count(*) AS n FROM media WHERE owner=?').bind(doomed.id).first()).n,26);
 await req('me',{cookie:managedCookie,expect:401});
 const during=await data(await req(managePath,{cookie:owner}));assert.equal(during.deleting,true);assert.equal(during.user.active,false);
 await req('members/'+doomed.id+'/access',{cookie:owner,method:'POST',data:{active:true},expect:409});
 await req(managePath,{cookie:owner,method:'POST',data:editPayload,expect:409});
 await req('media/'+photo+'/file',{cookie:owner,expect:404});
 await assert.rejects(db.prepare("INSERT INTO albums(id,owner,name) VALUES('late-album',?,'Late')").bind(doomed.id).run());
 await assert.rejects(db.prepare("INSERT INTO media(id,owner,name,type,size,object_key,status,created) VALUES('late-media',?,'Late','image/jpeg',4,?,'ready',1)").bind(doomed.id,doomed.id+'/late').run());
 await assert.rejects(db.prepare("UPDATE users SET active=1 WHERE id=?").bind(doomed.id).run());
 await db.prepare('DROP TRIGGER fail_delete_test').run();
 let deletion=await data(await deleteNext());assert.equal(deletion.done,false);assert.equal(deletion.remaining,6);
 for(let i=0;i<8&&!deletion.done;i++)deletion=await data(await deleteNext());assert.equal(deletion.done,true);
 assert.equal((await data(await deleteNext())).done,true);
 assert.equal(await db.prepare('SELECT id FROM users WHERE id=?').bind(doomed.id).first(),null);
 for(const [table,column] of [['media','owner'],['albums','owner'],['sessions','user_id'],['shares','recipient']])assert.equal((await db.prepare('SELECT count(*) AS n FROM '+table+' WHERE '+column+'=?').bind(doomed.id).first()).n,0);
 assert.equal(await db.prepare('SELECT value FROM settings WHERE key=?').bind('recovery:'+doomed.id).first(),null);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM parts WHERE media IN (?,?)').bind(photo,pending).first()).n,0);
 assert.equal((await db.prepare('SELECT count(*) AS n FROM shares WHERE media=?').bind(photo).first()).n,0);
 assert.equal((await r2.list({prefix:doomed.id+'/'})).objects.length,0);
 await assert.rejects(r2.resumeMultipartUpload(pendingRecord.object_key,pendingRecord.upload_id).uploadPart(1,jpeg));
 assert.ok(await r2.head(siblingPrefix));assert.ok(await r2.head(object.object_key));
 await req('media/'+upload+'/file',{cookie:owner});await req('me',{cookie:publicAdmin});
 // Deleted credentials cannot be used to recreate storage records, but the username can be registered again with a new ID.
 await assert.rejects(db.prepare("INSERT INTO sessions(token,user_id,expires) VALUES('late-token',?,?)").bind(doomed.id,Date.now()+100000).run());
 await req('members',{cookie:owner,method:'POST',data:{name:'New Account',username:'doomed-renamed',password:'brandnew-password',mustChange:false}});
 const recreated=await data(await logDoomed('doomed-renamed','brandnew-password'));assert.notEqual(recreated.user.id,doomed.id);
 console.log(`PASS: ${checks} API checks covering owner setup, roles, CSRF, multi-part upload, read-back checksums, private access, range download, sharing/revocation, trash/restore, password reset, Account Center, all-role recovery, answer privacy, recovery removal, rate limits and rollback, and account disable.`);
}finally{await mf.dispose()}
