import { createHmac, randomBytes } from 'node:crypto'
import { expect } from 'vitest'
function totp(secret){
 const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';let bits=''
 for(const c of secret.replace(/=+$/,''))bits+=alphabet.indexOf(c.toUpperCase()).toString(2).padStart(5,'0')
 const key=Buffer.from((bits.match(/.{8}/g)||[]).map(v=>parseInt(v,2)))
 const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(Math.floor(Date.now()/30000)))
 const hash=createHmac('sha1',key).update(counter).digest(),offset=hash[19]&15
 return String((hash.readUInt32BE(offset)&0x7fffffff)%1000000).padStart(6,'0')
}
export async function startRefundAuth(container,sql,docker,serviceToken,secret,actor){
 const name=container+'-refund-auth';let started=false
 const call=(path,method='GET',body=null,token=serviceToken)=>{
  const args=['exec','-i',container,'curl','-sS','--max-time','10','-w','\n%{http_code}','-X',method,'-H','Content-Type: application/json','-H','Authorization: Bearer '+token]
  if(body)args.push('--data-binary','@-')
  args.push('http://127.0.0.1:9999/'+path)
  const output=docker(args,body?JSON.stringify(body):undefined),cut=output.lastIndexOf('\n')
  return {status:Number(output.slice(cut+1)),data:JSON.parse(output.slice(0,cut))}
 }
 try{
  // Migration version numbers only; never copy accounts or authentication secrets.
  sql(docker(['exec','supabase_db_quest-platform','pg_dump','-U','postgres','-d','postgres','--data-only','--table=auth.schema_migrations','--no-owner']))
  docker(['run','-d','--name',name,'--network','container:'+container,
   '-e','GOTRUE_API_HOST=0.0.0.0','-e','GOTRUE_API_PORT=9999','-e','API_EXTERNAL_URL=http://127.0.0.1:9999',
   '-e','GOTRUE_SITE_URL=http://127.0.0.1:9999','-e','GOTRUE_DB_DRIVER=postgres','-e','GOTRUE_DB_DATABASE_URL=postgres://postgres@127.0.0.1:5432/postgres?search_path=auth',
   '-e','GOTRUE_JWT_SECRET='+secret,'-e','GOTRUE_JWT_AUD=authenticated','-e','GOTRUE_JWT_ADMIN_ROLES=service_role','-e','GOTRUE_JWT_DEFAULT_GROUP_NAME=authenticated',
   '-e','GOTRUE_EXTERNAL_EMAIL_ENABLED=true','-e','GOTRUE_MAILER_AUTOCONFIRM=true','-e','GOTRUE_MFA_ENABLED=true','-e','GOTRUE_MFA_TOTP_ENROLL_ENABLED=true','-e','GOTRUE_MFA_TOTP_VERIFY_ENABLED=true',
   'supabase/gotrue:v2.196.0']);started=true
  let ready=false
  for(let i=0;i<40;i++){try{if(call('health').status===200){ready=true;break}}catch{}await new Promise(r=>setTimeout(r,500))}
  expect(ready,'isolated Auth startup').toBe(true)
  sql(`update auth.users set created_at=now(),updated_at=now(),instance_id='00000000-0000-0000-0000-000000000000',aud='authenticated',role='authenticated',confirmation_token='',recovery_token='',email_change_token_new='',email_change='' where id='${actor}'`)
  sql(`do $$ declare c record; begin for c in select column_name from information_schema.columns where table_schema='auth' and table_name='users' and data_type in ('text','character varying') loop execute format('update auth.users set %I=coalesce(%I,'''') where id=%L',c.column_name,c.column_name,'${actor}'); end loop; end $$;`)
  const password=randomBytes(24).toString('hex')
  const updated=call('admin/users/'+actor,'PUT',{password,email_confirm:true})
  if(updated.status!==200){
   const logs=docker(['logs','--tail','20',name])
   const errors=logs.split('\n').flatMap(line=>{try{const row=JSON.parse(line);return row.error?[String(row.error)]:[]}catch{return []}}).join('\n')
   throw Error('Auth fixture update failed: '+errors.replaceAll(password,'[redacted]').replaceAll(serviceToken,'[redacted]').replaceAll(secret,'[redacted]'))
  }
  sql(`insert into auth.identities(provider_id,user_id,identity_data,provider,created_at,updated_at) values('${actor}','${actor}',jsonb_build_object('sub','${actor}','email','subscription-refund-edge@example.test','email_verified',true),'email',now(),now()) on conflict do nothing`)
  const login=call('token?grant_type=password','POST',{email:'subscription-refund-edge@example.test',password})
  expect(login.status,'real password login: '+(login.data.error_code||login.data.error||'')).toBe(200)
  const aal1=login.data.access_token
  const factor=call('factors','POST',{factor_type:'totp',friendly_name:'isolated refund test'},aal1)
  expect(factor.status,'real TOTP enrollment').toBe(200)
  const challenge=call('factors/'+factor.data.id+'/challenge','POST',{},aal1)
  expect(challenge.status).toBe(200)
  const verified=call('factors/'+factor.data.id+'/verify','POST',{challenge_id:challenge.data.id,code:totp(factor.data.totp.secret)},aal1)
  expect(verified.status,'real TOTP verification').toBe(200)
  return {token:verified.data.access_token,aal1,stop:()=>docker(['rm','-f',name])}
 }catch(error){if(started)docker(['rm','-f',name]);throw error}
}
