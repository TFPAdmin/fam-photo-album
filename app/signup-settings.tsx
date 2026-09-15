'use client';
import {useEffect,useState} from 'react';
export default function PublicSignupSettings({api}:{api:(path:string,data?:any)=>Promise<any>}){
 const [enabled,setEnabled]=useState<boolean|null>(null),[busy,setBusy]=useState(false),[error,setError]=useState('');
 useEffect(()=>{let active=true;api('signup-settings').then(r=>{if(active)setEnabled(r.enabled)}).catch(e=>{if(active&&!e.sessionEnded)setError(e.message)});return()=>{active=false}},[]);
 return <section className="account-section signup-settings"><h2>Public signup</h2><p>Allow people to create a Member account from the sign-in screen. Each account starts with a private collection.</p><label className="reset-choice"><input type="checkbox" role="switch" checked={enabled===true} disabled={busy||enabled===null} onChange={async e=>{const next=e.target.checked;setBusy(true);setError('');try{const r=await api('signup-settings',{enabled:next});setEnabled(r.enabled)}catch(e:any){if(!e.sessionEnded)setError(e.message)}finally{setBusy(false)}}}/><span>{busy?'Saving…':enabled===null?'Loading…':enabled?'Public signup is on':'Public signup is off'}</span></label>{enabled&&<p><a href="/?signup=1">Open public signup page</a></p>}{error&&<p className="error" role="alert">{error}</p>}</section>;
}
