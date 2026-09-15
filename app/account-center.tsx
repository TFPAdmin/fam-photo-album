'use client';
import {useEffect,useState} from 'react';
import {Button} from '@/components/ui/button';
import {Input} from '@/components/ui/input';
import {RECOVERY_QUESTIONS} from '@/lib/recovery-questions';

type Api=(path:string,data?:any,method?:string)=>Promise<any>;
function questionData(form:FormData){return [0,1,2].map(i=>({question:form.get('question'+i),answer:form.get('answer'+i)}))}
function Questions({initial=[]}:{initial?:string[]}){
 const [selected,setSelected]=useState<string[]>([0,1,2].map(i=>initial[i]||''));
 return <fieldset className="question-fields"><legend>Three secret questions</legend>{selected.map((value,i)=><div className="question-pair" key={i}>
  <label>Question {i+1}<select name={'question'+i} required value={value} onChange={e=>setSelected(old=>old.map((q,n)=>n===i?e.target.value:q))}><option value="" disabled>Choose a question</option>{RECOVERY_QUESTIONS.map(q=><option key={q.id} value={q.id} disabled={selected.includes(q.id)&&value!==q.id}>{q.label}</option>)}</select></label>
  <label>Answer {i+1}<Input name={'answer'+i} type="password" required minLength={3} maxLength={128} autoComplete="off" autoCapitalize="none" spellCheck={false}/></label>
 </div>)}<p className="fine-print">Answers ignore capitalization and extra spaces. For dates, use YYYY-MM-DD consistently.</p></fieldset>;
}
export function PasswordRecovery({api}:{api:Api}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[done,setDone]=useState(false);
 return <section className="auth-card recovery-card"><h1>Reset your password</h1>{done?<><p role="status">Your password has been changed. Sign in with your new password. Previous sessions have been signed out.</p><Button asChild><a href="/">Return to sign in</a></Button></>:<>
 <p>Select the same three questions you saved in Account Center and enter your answers.</p>
 <form onSubmit={async e=>{e.preventDefault();const form=e.currentTarget,d=new FormData(form);setBusy(true);setError('');try{await api('forgot-password',{username:d.get('username'),answers:questionData(d),password:d.get('password'),confirm:d.get('confirm')});form.reset();setDone(true)}catch(e:any){setError(e.message)}finally{setBusy(false)}}}>
 <fieldset disabled={busy} className="form-fields"><label>Username<Input name="username" required maxLength={40} autoComplete="username" autoCapitalize="none"/></label>
 <Questions/>
 <label>New password<Input name="password" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
 <label>Confirm new password<Input name="confirm" type="password" required minLength={12} maxLength={128} autoComplete="new-password"/></label>
 <Button type="submit">{busy?'Checking…':'Reset password'}</Button></fieldset></form>
 {error&&<p role="alert" className="error">{error}</p>}
 <p>If you haven’t saved questions or can’t remember your answers, ask your family admin for a temporary password.</p><Button variant="ghost" asChild><a href="/">Back to sign in</a></Button></>}</section>;
}
export default function AccountCenter({user,api,onUser,onPassword}:{user:any,api:Api,onUser:(user:any)=>void,onPassword:()=>void}){
 const [questions,setQuestions]=useState<string[]|null>(null),[error,setError]=useState(''),[notice,setNotice]=useState(''),[busy,setBusy]=useState(false),[version,setVersion]=useState(0);
 useEffect(()=>{let active=true;api('account').then(r=>{if(active)setQuestions(r.recoveryQuestions)}).catch(e=>{if(active)setError(e.message)});return()=>{active=false}},[user.id]);
 async function save(fn:()=>Promise<void>){setBusy(true);setError('');setNotice('');try{await fn()}catch(e:any){setError(e.message)}finally{setBusy(false)}}
 return <div className="account-center">{error&&<p className="error" role="alert">{error}</p>}{notice&&<p className="success" role="status">{notice}</p>}
 <section className="account-section"><h2>Your profile</h2><p>Your display name appears on memories you share.</p>
 <form onSubmit={e=>{e.preventDefault();const d=new FormData(e.currentTarget);save(async()=>{const r=await api('account/profile',{name:d.get('name')});onUser(r.user);setNotice('Profile saved.')})}}><label>Username<Input value={user.username} readOnly autoComplete="username"/></label><label>Display name<Input name="name" defaultValue={user.name} required maxLength={80} autoComplete="name"/></label><Button disabled={busy}>Save profile</Button></form></section>
 <section className="account-section"><h2>Password</h2><p>Change your password using your current password. Other sessions will be signed out.</p><Button variant="outline" onClick={onPassword}>Change password</Button></section>
 <section className="account-section"><h2>Password recovery</h2><p>{questions===null?'Loading recovery settings…':questions.length?'Recovery questions are set. Enter three new answers below to replace them.':'Set up three questions now so you can reset a forgotten password.'}</p>
 <p className="recovery-advice">Family facts can be guessed. Use private, memorable answers that others don’t know; answers don’t need to be literal facts. Keep them in your password manager. Anyone who knows all three can reset your password.</p>
 {questions!==null&&<form key={version} onSubmit={e=>{e.preventDefault();const form=e.currentTarget,d=new FormData(form);save(async()=>{const answers=questionData(d);await api('account/recovery',{current:d.get('current'),answers});setQuestions(answers.map(a=>String(a.question)));setVersion(v=>v+1);setNotice('Recovery questions saved. Remember your three questions and answers; saved answers cannot be displayed.')})}}><fieldset disabled={busy} className="form-fields"><label>Current password<Input name="current" type="password" required maxLength={128} autoComplete="current-password"/></label><Questions initial={questions}/><Button>{busy?'Saving…':'Save recovery questions'}</Button></fieldset></form>}
 {questions!==null&&questions.length>0&&<details className="remove-recovery"><summary>Turn off question-based recovery</summary><form onSubmit={e=>{e.preventDefault();const form=e.currentTarget,d=new FormData(form);save(async()=>{await api('account/recovery',{current:d.get('current')},'DELETE');setQuestions([]);setVersion(v=>v+1);setNotice('Question-based recovery is turned off.')})}}><p>You will need an admin’s help if you forget your password.</p><label>Current password<Input name="current" type="password" required maxLength={128} autoComplete="current-password"/></label><Button variant="outline" disabled={busy}>Remove recovery questions</Button></form></details>}
 </section></div>;
}
