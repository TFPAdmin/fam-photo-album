'use client';
import {useEffect,useRef,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {Questions,questionData} from './account-center';

type Api=(path:string,data?:any,method?:string)=>Promise<any>;
export default function MemberEditor({memberId,api,onSaved}:{memberId:string,api:Api,onSaved:(message:string)=>Promise<void>}){
 const [record,setRecord]=useState<any>(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[recoveryAction,setRecoveryAction]=useState('keep'),[password,setPassword]=useState(''),[deleteOpen,setDeleteOpen]=useState(false),[confirmation,setConfirmation]=useState(''),[progress,setProgress]=useState('');
 const alive=useRef(true),paused=useRef(false);
 useEffect(()=>{alive.current=true;api('members/'+memberId+'/manage').then(r=>{if(alive.current){setRecord(r);if(r.deleting)setDeleteOpen(true)}}).catch(e=>{if(alive.current&&!e.sessionEnded)setError(e.message)});return()=>{alive.current=false;paused.current=true}},[memberId]);
 async function save(e:React.FormEvent<HTMLFormElement>){
  e.preventDefault();const form=e.currentTarget,d=new FormData(form);setBusy(true);setError('');
  try{await api('members/'+memberId+'/manage',{name:d.get('name'),username:d.get('username'),role:d.get('role'),active:d.get('active')==='on',mustChange:d.get('mustChange')==='on',password,confirm:d.get('confirm'),recoveryAction,answers:recoveryAction==='replace'?questionData(d):undefined});form.reset();setPassword('');await onSaved('Account updated. The member must sign in again.')}catch(e:any){if(!e.sessionEnded)setError(e.message)}finally{if(alive.current)setBusy(false)}
 }
 async function remove(e:React.FormEvent){
  e.preventDefault();paused.current=false;setBusy(true);setError('');setProgress('Disabling the account and removing its stored files…');
  try{
   while(alive.current&&!paused.current){
    const result=await api('members/'+memberId+'/delete',{confirmUsername:confirmation});
    if(!alive.current)return;
    if(result.done){await onSaved('Account and uploaded media permanently deleted.');return}
    setRecord((r:any)=>({...r,deleting:true}));
    setProgress(result.remaining?`${result.remaining} files remaining. Keep this page open to finish.`:'Finishing storage and account cleanup…');
   }
   if(alive.current)setProgress('Deletion paused. Resume here to finish. The account remains disabled.');
  }catch(e:any){if(alive.current&&!e.sessionEnded){setError(e.message);setProgress('Retry deletion to finish. Successfully removed files will not be restored.');const latest=await api('members/'+memberId+'/manage').catch(()=>null);if(latest&&alive.current)setRecord(latest)}}finally{if(alive.current)setBusy(false)}
 }
 if(!record)return <>{error?<p className="error" role="alert">{error}</p>:<p role="status">Loading account…</p>}</>;
 const member=record.user;
 return <div className="member-editor">
 {error&&<p className="error" role="alert">{error}</p>}
 {!record.deleting&&<form onSubmit={save}><fieldset className="form-fields" disabled={busy}>
 <h3>Profile and access</h3><label>Name<Input name="name" defaultValue={member.name} required maxLength={80} autoComplete="off"/></label>
 <label>Username<Input name="username" defaultValue={member.username} required pattern="[a-zA-Z0-9_.-]{3,40}" maxLength={40} autoCapitalize="none" autoComplete="off" spellCheck={false}/></label>
 <label>Access level<select className="member-select" name="role" defaultValue={member.role}><option value="member">Member</option><option value="admin">Admin</option></select></label>
 <label className="reset-choice"><input type="checkbox" name="active" defaultChecked={member.active}/><span>Allow this account to sign in</span></label>
 <label className="reset-choice"><input type="checkbox" name="mustChange" defaultChecked={member.mustChange}/><span>Require password change at next sign-in</span></label>
 <h3>Password</h3><p className="fine-print">Leave blank to keep the existing password. Existing passwords cannot be displayed.</p>
 <label>New password<Input name="password" type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} maxLength={128} autoComplete="new-password"/></label>
 {password&&<label>Confirm new password<Input name="confirm" type="password" required minLength={8} maxLength={128} autoComplete="new-password"/></label>}
 <h3>Recovery questions</h3><p className="fine-print">{record.recoveryQuestions.length?'This account has three saved questions.':'No questions are configured.'} Saved answers cannot be displayed.</p>
 <label>Recovery action<select className="member-select" value={recoveryAction} onChange={e=>setRecoveryAction(e.target.value)}><option value="keep">Keep current questions</option><option value="clear">Clear all recovery questions</option><option value="replace">Replace questions and answers</option></select></label>
 {password&&recoveryAction==='keep'&&<p className="fine-print">Changing the password also clears the old recovery questions. Choose Replace to set new ones now.</p>}
 {recoveryAction==='replace'&&<Questions initial={record.recoveryQuestions}/>}
 <Button type="submit">{busy?'Saving…':'Save account changes'}</Button>
 </fieldset></form>}
 <section className="account-delete"><h3>Delete account permanently</h3>
 <p>This deletes @{member.username}, all {record.media.count} uploaded files (including recently removed files), albums, sharing records, and recovery settings. It cannot be undone.</p>
 <p>Files uploaded by other members remain with their uploaders.</p>
 {!deleteOpen?<Button variant="outline" className="remove-button" disabled={busy} onClick={()=>setDeleteOpen(true)}>Delete this account…</Button>:<form onSubmit={remove}>
 <label>Type {member.username} to confirm<Input value={confirmation} onChange={e=>setConfirmation(e.target.value)} required autoComplete="off" autoCapitalize="none" spellCheck={false} disabled={busy}/></label>
 <Button className="delete-account-button" type="submit" disabled={busy||confirmation!==member.username}>{busy?'Deleting…':record.deleting?'Resume permanent deletion':'Delete account and all uploaded media'}</Button>
 {busy&&<Button type="button" variant="outline" onClick={()=>{paused.current=true;setProgress('Pausing after the current batch…')}}>Pause after current batch</Button>}
 </form>}
 {progress&&<p role="status" aria-live="polite">{progress}</p>}
 </section></div>;
}
