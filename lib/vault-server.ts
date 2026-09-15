import { env } from 'cloudflare:workers';
import { RECOVERY_QUESTIONS,normalizeAnswer } from './recovery-questions';
const CHUNK=8*1024*1024;
const db=()=>{if(!env.DB)throw new Error('Database unavailable');return env.DB};
const bucket=()=>{if(!env.BUCKET)throw new Error('Storage unavailable');return env.BUCKET};
const stmt=(s:string,...v:any[])=>db().prepare(s).bind(...v);
const one=(s:string,...v:any[])=>stmt(s,...v).first<any>();
const all=async(s:string,...v:any[])=>(await stmt(s,...v).all<any>()).results;
const now=()=>Date.now(); const id=()=>crypto.randomUUID();
const hex=(b:ArrayBuffer)=>Array.from(new Uint8Array(b),n=>n.toString(16).padStart(2,'0')).join('');
const sha=async(b:BufferSource)=>hex(await crypto.subtle.digest('SHA-256',b));
const encode=(s:string)=>new TextEncoder().encode(s);
function fail(message:string,status=400):never{throw Object.assign(new Error(message),{status})}
function eq(a:string,b:string){if(a.length!==b.length)return false;let d=0;for(let i=0;i<a.length;i++)d|=a.charCodeAt(i)^b.charCodeAt(i);return d===0}
async function pw(p:string,salt=hex(crypto.getRandomValues(new Uint8Array(16)).buffer)){const k=await crypto.subtle.importKey('raw',encode(p), 'PBKDF2',false,['deriveBits']);return salt+':'+hex(await crypto.subtle.deriveBits({name:'PBKDF2',salt:encode(salt),iterations:100000,hash:'SHA-256'},k,256))}
function password(p:any){if(typeof p!=='string'||p.length<12||p.length>128)fail('Use a password with 12–128 characters.');return p}
const profile=(u:any)=>({id:u.id,username:u.username,name:u.name,role:u.role,mustChange:!!u.must_change,active:!!u.active});
function json(x:any,status=200,headers:Record<string,string>={}){return Response.json(x,{status,headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers}})}
async function throttle(key:string,max:number){const t=now();await stmt('INSERT INTO limits(key,count,reset) VALUES(?,1,?) ON CONFLICT(key) DO UPDATE SET count=CASE WHEN reset<? THEN 1 ELSE count+1 END, reset=CASE WHEN reset<? THEN excluded.reset ELSE reset END',key,t+900000,t,t).run();const r=await one('SELECT count FROM limits WHERE key=?',key);if(r.count>max)fail('Too many attempts. Try again in 15 minutes.',429)}
async function bounded(r:Request,max:number){const reader=r.body?.getReader();if(!reader)return new ArrayBuffer(0);const chunks:Uint8Array[]=[];let total=0;while(true){const {done,value}=await reader.read();if(done)break;total+=value.byteLength;if(total>max){await reader.cancel();fail('Request too large.',413)}chunks.push(value)}const out=new Uint8Array(total);let at=0;for(const c of chunks){out.set(c,at);at+=c.length}return out.buffer}
async function body(r:Request){if(Number(r.headers.get('content-length')||0)>20000)fail('Request too large',413);const s=new TextDecoder().decode(await bounded(r,20000));if(s.length>20000)fail('Request too large',413);try{return JSON.parse(s)}catch{fail('Invalid request')}}
function authToken(r:Request){return (r.headers.get('cookie')||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('auth='))?.slice(5)}
async function user(r:Request){const token=authToken(r);if(!token)fail('Please sign in.',401);const u=await one('SELECT u.*,s.token AS session_token FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token=? AND s.expires>? AND u.active=1',await sha(encode(token)),now());if(!u)fail('Please sign in again.',401);return u}
async function session(u:any){const token=hex(crypto.getRandomValues(new Uint8Array(32)).buffer);await stmt('INSERT INTO sessions(token,user_id,expires) VALUES(?,?,?)',await sha(encode(token)),u.id,now()+86400000).run();return json({user:profile(u)},200,{'Set-Cookie':`auth=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=86400`})}
async function access(u:any,mid:string,write=false){const m=await one('SELECT * FROM media WHERE id=?',mid);if(!m)fail('Media not found.',404);if(m.owner!==u.id&&u.role!=='owner'&&(write||m.deleted||m.status!=='ready'||!await one('SELECT media FROM shares WHERE media=? AND recipient=?',mid,u.id)))fail('Media not found.',404);return m}
function admin(u:any){if(!['owner','admin'].includes(u.role))fail('Account management access required.',403)}
function manage(u:any,t:any){admin(u);if(!t)fail('Member not found',404);if(t.role==='owner'||(u.role==='admin'&&t.role!=='member'))fail('Only the owner can manage this account.',403)}
function recoveryAnswers(value:any):{question:string,answer:string}[]{
 if(!Array.isArray(value)||value.length!==3)fail('Choose three different recovery questions and answer each one.');
 const answers=value.map(a=>{
  if(!a||!RECOVERY_QUESTIONS.some(q=>q.id===a.question)||typeof a.answer!=='string'||a.answer.length>128)fail('Choose a valid question and an answer of 3–128 characters.');
  const answer=normalizeAnswer(a.answer);if(answer.length<3)fail('Use answers with at least 3 characters.');
  return {question:a.question as string,answer};
 });
 if(new Set(answers.map(a=>a.question)).size!==3)fail('Choose three different questions.');
 return answers;
}
export async function handle(r:Request){try{return await route(r)}catch(e:any){if(!e.status)console.error('Vault request failed',e);return json({error:e.status?e.message:'The service is unavailable. Your files have not been marked verified. Please try again.'},e.status||503)}}
async function route(r:Request):Promise<Response>{
 const url=new URL(r.url);const p=url.pathname.replace('/api/vault/','').split('/');const method=r.method;
 if(method!=='GET'&&r.headers.get('origin')!==url.origin)fail('Invalid request origin.',403);
 if(p[0]==='status'&&method==='GET')return json({needsSetup:!await one("SELECT id FROM users WHERE role='owner' LIMIT 1")});
 if(p[0]==='setup'&&method==='POST'){
  await throttle('setup:'+r.headers.get('cf-connecting-ip'),10);const b=await body(r);const key=(env as any).SETUP_KEY;
  if(!key||typeof b.key!=='string'||!eq(key,b.key))fail('The setup key is incorrect.',403);
  const username=String(b.username||'').toLowerCase();if(!/^[a-z0-9_.-]{3,40}$/.test(username))fail('Use a username with 3–40 letters, numbers, periods, hyphens or underscores.');
  const u={id:id(),username,name:String(b.name||'Owner').trim().slice(0,80),password:await pw(password(b.password)),role:'owner',must_change:0,active:1};
  try{await db().batch([stmt("INSERT INTO settings(key,value) VALUES('owner_initialized','yes')"),stmt('INSERT INTO users(id,username,name,password,role,must_change,active,created) VALUES(?,?,?,?,?,0,1,?)',u.id,u.username,u.name,u.password,u.role,now())])}catch{fail('The owner account has already been created.',409)}return session(u);
 }
 if(p[0]==='login'&&method==='POST'){
  const b=await body(r),username=String(b.username||'').toLowerCase();await throttle('ip:'+r.headers.get('cf-connecting-ip'),60);await throttle('user:'+username,12);
  const u=await one('SELECT * FROM users WHERE username=? AND active=1',username);const input=typeof b.password==='string'&&b.password.length<=128?b.password:'';const hash=await pw(input,u?.password.split(':')[0]||'00000000000000000000000000000000');if(!u||!eq(hash,u.password))fail('Username or password is incorrect.',401);return session(u);
 }
 // The former Cloudflare-secret recovery endpoint is intentionally retired.
 if(p[0]==='owner-reset')fail('Not found.',404);
 if(p[0]==='forgot-password'&&method==='POST'){
  await throttle('recovery-ip:'+r.headers.get('cf-connecting-ip'),15);
  const b=await body(r),username=String(b?.username||'').trim().toLowerCase().slice(0,40);
  await throttle('recovery-user:'+username,5);
  const invalid=()=>fail('Unable to reset this account. Check your username, questions and answers, or ask your family admin.',400);
  const input=recoveryAnswers(b?.answers);
  const account=await one('SELECT u.*,s.value AS recovery FROM users u LEFT JOIN settings s ON s.key=?||u.id WHERE u.username=? AND u.active=1 AND u.must_change=0','recovery:',username);
  const saved=account?.recovery?JSON.parse(account.recovery):null;
  let valid=!!saved;
  // Always check all three answers, including dummy hashes for unknown accounts.
  for(const answer of input){
   const stored=saved?.answers.find((a:any)=>a.question===answer.question);
   const hash=await pw(answer.answer,stored?.hash.split(':')[0]||'00000000000000000000000000000000');
   if(!stored||!eq(hash,stored.hash))valid=false;
  }
  if(!valid)invalid();
  const next=password(b.password);if(next!==b.confirm)fail('The new passwords do not match.');
  const hashed=await pw(next),key='recovery:'+account.id;
  // Each successful reset changes the recovery version. Stale/concurrent requests
  // and credentials changed by an administrator cannot overwrite newer credentials.
  const result=await db().batch([
   stmt('UPDATE users SET password=?,must_change=0 WHERE id=? AND password=? AND active=1 AND must_change=0 AND EXISTS(SELECT 1 FROM settings WHERE key=? AND value=?)',hashed,account.id,account.password,key,account.recovery),
   stmt('DELETE FROM sessions WHERE user_id=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)',account.id,account.id,hashed),
   stmt('UPDATE settings SET value=? WHERE key=? AND value=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)',JSON.stringify({...saved,version:id()}),key,account.recovery,account.id,hashed),
   stmt('DELETE FROM limits WHERE key=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)','user:'+account.username,account.id,hashed)
  ]);
  if(!result[0].meta.changes)invalid();
  return json({ok:true});
 }
 const u=await user(r);
 const expectedUser=r.headers.get('x-vault-user');if(expectedUser&&expectedUser!==u.id)return json({error:'The signed-in account changed in another tab. Please sign in with the account you want to use.',code:'SESSION_CHANGED'},409);
 if(p[0]==='me')return json({user:profile(u)});
 if(p[0]==='logout'&&method==='POST'){const t=authToken(r)||'';await stmt('DELETE FROM sessions WHERE token=?',await sha(encode(t))).run();return json({ok:true},200,{'Set-Cookie':'auth=; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=0'})}
 if(p[0]==='password'&&method==='POST'){const b=await body(r);await throttle('password:'+u.id,12);if(!eq(await pw(String(b.current||''),u.password.split(':')[0]),u.password))fail('Current password is incorrect.');const nextPassword=await pw(password(b.password));await db().batch([stmt('UPDATE users SET password=?,must_change=0 WHERE id=?',nextPassword,u.id),stmt('DELETE FROM sessions WHERE user_id=?',u.id)]);return session({...u,password:nextPassword,must_change:0})}
 if(u.must_change)fail('Change your temporary password before continuing.',403);
 if(p[0]==='account'){
  if(method==='GET'){
   const saved=await one('SELECT value FROM settings WHERE key=?','recovery:'+u.id);
   return json({user:profile(u),recoveryQuestions:saved?JSON.parse(saved.value).answers.map((a:any)=>a.question):[]});
  }
  const b=await body(r);
  if(p[1]==='profile'&&method==='POST'){
   const name=typeof b.name==='string'?b.name.trim():'';
   if(!name||name.length>80)fail('Use a display name with 1–80 characters.');
   await stmt('UPDATE users SET name=? WHERE id=?',name,u.id).run();
   return json({user:profile({...u,name})});
  }
  if(p[1]==='recovery'&&(method==='POST'||method==='DELETE')){
   await throttle('recovery-settings:'+u.id,10);
   if(typeof b.current!=='string'||b.current.length>128||!eq(await pw(b.current,u.password.split(':')[0]),u.password))fail('Current password is incorrect.');
   if(method==='DELETE'){
    await stmt('DELETE FROM settings WHERE key=? AND EXISTS(SELECT 1 FROM users WHERE id=? AND password=?)','recovery:'+u.id,u.id,u.password).run();
   }else{
    const answers=recoveryAnswers(b.answers);
    const hashed=[];for(const a of answers)hashed.push({question:a.question,hash:await pw(a.answer)});
    const result=await stmt('INSERT INTO settings(key,value) SELECT ?,? WHERE EXISTS(SELECT 1 FROM users WHERE id=? AND password=? AND active=1 AND must_change=0) ON CONFLICT(key) DO UPDATE SET value=excluded.value','recovery:'+u.id,JSON.stringify({version:id(),answers:hashed}),u.id,u.password).run();
    if(!result.meta.changes)fail('Your account changed. Please sign in again.',401);
   }
   return json({ok:true});
  }
  fail('Not found.',404);
 }
 if(p[0]==='members'){
  if(method==='GET')return json({members:await all("SELECT id,username,name,role,active FROM users WHERE (active=1 OR ?=1) AND (role<>'owner' OR ?=1) ORDER BY name COLLATE NOCASE",u.role==='owner'||u.role==='admin'?1:0,u.role==='owner'?1:0)});
  admin(u);const b=await body(r);
  if(method==='POST'&&!p[1]){const username=String(b.username||'').toLowerCase();if(!/^[a-z0-9_.-]{3,40}$/.test(username))fail('Use a username with 3–40 letters, numbers, periods, hyphens or underscores.');const role=u.role==='owner'&&b.role==='admin'?'admin':'member';try{await stmt('INSERT INTO users(id,username,name,password,role,created) VALUES(?,?,?,?,?,?)',id(),username,String(b.name||username).trim().slice(0,80),await pw(password(b.password)),role,now()).run()}catch{fail('That username is already in use.',409)}return json({ok:true})}
  const t=await one('SELECT * FROM users WHERE id=?',p[1]);manage(u,t);
  if(p[2]==='reset'&&method==='POST'){await db().batch([stmt('UPDATE users SET password=?,must_change=1 WHERE id=?',await pw(password(b.password)),t.id),stmt('DELETE FROM sessions WHERE user_id=?',t.id),stmt('DELETE FROM settings WHERE key=?','recovery:'+t.id)]);return json({ok:true})}
  if(p[2]==='access'&&method==='POST'){await db().batch([stmt('UPDATE users SET active=? WHERE id=?',b.active?1:0,t.id),stmt('DELETE FROM sessions WHERE user_id=?',t.id)]);return json({ok:true})}
 }
 if(p[0]==='albums'){
  if(method==='GET')return json({albums:await all('SELECT * FROM albums WHERE owner=? ORDER BY name',u.id)});
  if(method==='POST'){const b=await body(r);const name=String(b.name||'').trim();if(!name||name.length>80)fail('Album names must be 1–80 characters.');await stmt('INSERT INTO albums(id,owner,name) VALUES(?,?,?)',id(),u.id,name).run();return json({ok:true})}
 }
 if(p[0]==='media'&&!p[1]&&method==='GET'){
  const view=url.searchParams.get('view')||'mine',offset=Math.max(0,Number(url.searchParams.get('offset'))||0);let where='m.owner=? AND m.deleted IS NULL',args:any[]=[u.id];
  if(view==='shared'){where='m.deleted IS NULL AND EXISTS(SELECT 1 FROM shares s WHERE s.media=m.id AND s.recipient=?)';}
  if(view==='family'){if(u.role!=='owner')fail('Owner access required.',403);where='m.deleted IS NULL';args=[]}
  const member=url.searchParams.get('member');if(member){if(u.role!=='owner'||view!=='family')fail('This filter is available in the owner’s family collection.',403);where+=' AND m.owner=?';args.push(member)}
  if(view==='trash')where='m.owner=? AND m.deleted IS NOT NULL';
  const album=url.searchParams.get('album');if(album){where+=' AND m.album=?';args.push(album)}
  return json({media:await all(`SELECT m.*,u.name AS owner_name,a.name AS album_name,(SELECT count(*) FROM shares s WHERE s.media=m.id) AS shared_count FROM media m JOIN users u ON u.id=m.owner LEFT JOIN albums a ON a.id=m.album WHERE ${where} AND m.status='ready' ORDER BY m.created DESC LIMIT 100 OFFSET ?`,...args,offset),stats:await one("SELECT count(*) AS count,COALESCE(sum(size),0) AS bytes FROM media WHERE owner=? AND status='ready' AND deleted IS NULL",u.id)});
 }
 if(p[0]==='uploads'&&!p[1]&&method==='POST'){
  const b=await body(r);if(!Number.isSafeInteger(b.size)||b.size<=0||b.size>20*1024**3)fail('Choose a file up to 20 GB.');
  const name=String(b.name||'').slice(0,255);let type=String(b.type||'');if(!/^(image\/(jpeg|png|webp|gif|heic|heif|avif|tiff)|video\/(mp4|quicktime|webm|x-matroska|3gpp))$/.test(type)){const ext=name.split('.').pop()?.toLowerCase();const types:any={heic:'image/heic',heif:'image/heif',mov:'video/quicktime',mp4:'video/mp4',m4v:'video/mp4',jpg:'image/jpeg',jpeg:'image/jpeg',png:'image/png',webm:'video/webm'};if(!types[ext||''])fail('Choose a supported photo or video.');type=types[ext||'']}
  if(b.album&&!await one('SELECT id FROM albums WHERE id=? AND owner=?',b.album,u.id))fail('Album not found.');
  const mid=id(),key=u.id+'/'+mid;const upload=await bucket().createMultipartUpload(key,{httpMetadata:{contentType:type}});
  try{await stmt('INSERT INTO media(id,owner,name,type,size,object_key,upload_id,status,album,created,taken) VALUES(?,?,?,?,?,?,?,?,?,?,?)',mid,u.id,name,type,b.size,key,upload.uploadId,'uploading',b.album||null,now(),Number.isFinite(b.taken)?b.taken:null).run()}catch(e){await upload.abort();throw e}return json({id:mid,chunkSize:CHUNK});
 }
 if(p[0]==='uploads'&&p[1]){
  const m=await access(u,p[1],true);if(m.owner!==u.id)fail('Upload belongs to another account.',403);
  if(p[2]==='part'&&method==='PUT'){
   if(m.status!=='uploading')fail('This upload is no longer accepting parts.');const n=Number(url.searchParams.get('part'));const expected=Math.min(CHUNK,m.size-(n-1)*CHUNK);if(!Number.isInteger(n)||n<1||expected<=0)fail('Invalid part.');
   if(Number(r.headers.get('content-length')||0)>CHUNK)fail('Part too large.',413);
   const bytes=await bounded(r,CHUNK);if(bytes.byteLength!==expected)fail('The upload was incomplete. Retry this file.');const hash=await sha(bytes);if(hash!==r.headers.get('x-content-sha256'))fail('Upload checksum mismatch.');
   const part=await bucket().resumeMultipartUpload(m.object_key,m.upload_id).uploadPart(n,bytes);
   await stmt('INSERT INTO parts(media,part,etag,hash,size) VALUES(?,?,?,?,?) ON CONFLICT(media,part) DO UPDATE SET etag=excluded.etag,hash=excluded.hash,size=excluded.size,verified=0',m.id,n,part.etag,hash,bytes.byteLength).run();return json({ok:true});
  }
  if(p[2]==='complete'&&method==='POST'){
   if(m.status==='ready'||m.status==='verifying')return json({ok:true});const ps=await all('SELECT * FROM parts WHERE media=? ORDER BY part',m.id);if(ps.length!==Math.ceil(m.size/CHUNK)||ps.some((x,i)=>x.part!==i+1)||ps.reduce((a,x)=>a+x.size,0)!==m.size)fail('Some parts are missing.');
   let head=await bucket().head(m.object_key);if(!head){await bucket().resumeMultipartUpload(m.object_key,m.upload_id).complete(ps.map(x=>({partNumber:x.part,etag:x.etag})));head=await bucket().head(m.object_key)}if(!head||head.size!==m.size)fail('Stored size does not match.');await stmt("UPDATE media SET status='verifying' WHERE id=?",m.id).run();return json({ok:true});
  }
  if(p[2]==='verify'&&method==='POST'){
   if(!['verifying','ready'].includes(m.status))fail('Complete the upload first.');const b=await body(r);const part=await one('SELECT * FROM parts WHERE media=? AND part=?',m.id,b.part);if(!part)fail('Part not found.');
   const obj=await bucket().get(m.object_key,{range:{offset:(part.part-1)*CHUNK,length:part.size}});if(!obj||await sha(await obj.arrayBuffer())!==part.hash)fail('Stored-file verification failed. Keep the original and retry.');await stmt('UPDATE parts SET verified=1 WHERE media=? AND part=?',m.id,part.part).run();const unverified=await one('SELECT count(*) AS n FROM parts WHERE media=? AND verified=0',m.id);if(!unverified.n)await stmt("UPDATE media SET status='ready' WHERE id=?",m.id).run();return json({verified:!unverified.n});
  }
 }
 if(p[0]==='media'&&p[1]){
  const mid=p[1];const write=method!=='GET';const m=await access(u,mid,write);
  if(p[2]==='file'&&method==='GET'){
   if(m.status!=='ready'||m.deleted)fail('File is unavailable.',404);
   const range=r.headers.get('range');let opts:any={};if(range){const match=range.match(/^bytes=(\d+)-(\d*)$/);if(!match)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${m.size}`}});const start=Number(match[1]),end=match[2]?Math.min(Number(match[2]),m.size-1):m.size-1;if(start> end||start>=m.size)return new Response(null,{status:416,headers:{'Content-Range':`bytes */${m.size}`}});opts.range={offset:start,length:end-start+1}}
   const obj=await bucket().get(m.object_key,opts);if(!obj||!('body' in obj))fail('Stored file unavailable.',404);const headers:Record<string,string>={'Content-Type':m.type,'Content-Disposition':`${url.searchParams.has('download')?'attachment':'inline'}; filename*=UTF-8''${encodeURIComponent(m.name)}`,'Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff','Accept-Ranges':'bytes','Content-Security-Policy':"default-src 'none'; sandbox"};if(opts.range){headers['Content-Range']=`bytes ${opts.range.offset}-${opts.range.offset+opts.range.length-1}/${m.size}`;headers['Content-Length']=String(opts.range.length)}else headers['Content-Length']=String(m.size);return new Response(obj.body,{status:range?206:200,headers});
  }
  if(p[2]==='thumbnail'){
   if(method==='PUT'){if(m.status!=='ready')fail('Verify the original first.');if(Number(r.headers.get('content-length')||0)>500000)fail('Thumbnail too large.');const b=await bounded(r,500000);const a=new Uint8Array(b);if(b.byteLength>500000||a[0]!==255||a[1]!==216||a[2]!==255)fail('Invalid thumbnail.');await bucket().put(m.object_key+'.thumb',b,{httpMetadata:{contentType:'image/jpeg'}});await stmt('UPDATE media SET thumbnail=1 WHERE id=?',mid).run();return json({ok:true})}
   if(method==='GET'){if(m.deleted||m.status!=='ready')fail('Unavailable.',404);const obj=await bucket().get(m.object_key+'.thumb');if(!obj)fail('Thumbnail unavailable.',404);return new Response(obj.body,{headers:{'Content-Type':'image/jpeg','Cache-Control':'private, no-store','X-Content-Type-Options':'nosniff'}})}
  }
  if(p[2]==='shares'){
   if(m.owner!==u.id&&u.role!=='owner')fail('Only the uploader or owner can manage sharing.',403);
   if(method==='GET')return json({recipients:(await all('SELECT recipient FROM shares WHERE media=?',mid)).map(x=>x.recipient)});
   if(method==='POST'){const b=await body(r);if(!Array.isArray(b.recipients)||b.recipients.length>200)fail('Choose family members.');const recipients=[...new Set(b.recipients)] as string[];for(const x of recipients)if(!await one('SELECT id FROM users WHERE id=? AND active=1',x))fail('Member unavailable.');await db().batch([stmt('DELETE FROM shares WHERE media=?',mid),...recipients.filter(x=>x!==m.owner).map(x=>stmt('INSERT INTO shares(media,recipient) VALUES(?,?)',mid,x))]);return json({ok:true})}
  }
  if(p[2]==='album'&&method==='POST'){const b=await body(r);if(b.album&&!await one('SELECT id FROM albums WHERE id=? AND owner=?',b.album,m.owner))fail('Album not found.');await stmt('UPDATE media SET album=? WHERE id=?',b.album||null,mid).run();return json({ok:true})}
  if(p[2]==='trash'&&method==='POST'){await stmt('UPDATE media SET deleted=? WHERE id=?',now(),mid).run();return json({ok:true})}
  if(p[2]==='restore'&&method==='POST'){await stmt('UPDATE media SET deleted=NULL WHERE id=?',mid).run();return json({ok:true})}
 }
 fail('Not found.',404);
}
