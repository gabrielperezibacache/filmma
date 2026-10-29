import {spawn} from 'node:child_process';

type Operation='protect'|'unprotect';
/** DPAPI binds the Windows credential file to the signed-in OS user.
 * Secrets travel through stdin, never arguments, environment or diagnostic logs. */
async function windowsDpapi(operation:Operation,text:string):Promise<string>{
 const method=operation==='protect'?'Protect':'Unprotect';
 const input=operation==='protect'?'[Text.Encoding]::UTF8.GetBytes($inputText)':'[Convert]::FromBase64String($inputText)';
 const output=operation==='protect'?'[Convert]::ToBase64String($result)':'[Text.Encoding]::UTF8.GetString($result)';
 const script=`$ErrorActionPreference='Stop'; Add-Type -AssemblyName System.Security; [Console]::InputEncoding=[Text.UTF8Encoding]::new($false); [Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); $inputText=[Console]::In.ReadToEnd(); $bytes=${input}; $entropy=[Text.Encoding]::UTF8.GetBytes('filmma-provider-credentials-v1'); $result=[Security.Cryptography.ProtectedData]::${method}($bytes,$entropy,[Security.Cryptography.DataProtectionScope]::CurrentUser); [Console]::Out.Write(${output})`;
 return new Promise((resolve,reject)=>{
  const child=spawn('powershell.exe',['-NoLogo','-NoProfile','-NonInteractive','-Command',script],{windowsHide:true,stdio:['pipe','pipe','pipe']});
  let output='',failed=false;
  const timer=setTimeout(()=>{failed=true;child.kill();reject(new Error('Windows credential protection timed out.'));},15000);
  child.stdout.setEncoding('utf8');child.stdout.on('data',chunk=>{output+=chunk;if(Buffer.byteLength(output)>3*1024*1024){failed=true;child.kill();}});
  child.stderr.resume();child.stdin.on('error',()=>{});
  child.on('error',()=>{clearTimeout(timer);reject(new Error('Windows credential protection is unavailable.'));});
  child.on('close',code=>{clearTimeout(timer);if(code!==0||failed)reject(new Error('Windows credential protection failed.'));else resolve(output);});
  child.stdin.end(text,'utf8');
 });
}
export function createProviderCredentialCodec(options:{platform?:NodeJS.Platform;run?:(operation:Operation,text:string)=>Promise<string>}={}){
 const windows=(options.platform??process.platform)==='win32',run=options.run??windowsDpapi;
 return {
  windows,
  async encode(serialized:string){
   if(!windows)return serialized;
   const ciphertext=await run('protect',serialized);
   if(!ciphertext||!/^[A-Za-z0-9+/]+={0,2}$/.test(ciphertext))throw new Error('Windows returned invalid protected credentials.');
   return JSON.stringify({format:'filmma-dpapi-v1',ciphertext});
  },
  async decode(serialized:string){
   if(!windows)return serialized;
   const envelope=JSON.parse(serialized);
   if(envelope?.format!=='filmma-dpapi-v1'||typeof envelope.ciphertext!=='string'||!envelope.ciphertext.length||!/^[A-Za-z0-9+/]+={0,2}$/.test(envelope.ciphertext))throw new Error('Reconnect the account to protect its Windows credentials.');
   const plaintext=await run('unprotect',envelope.ciphertext);
   if(Buffer.byteLength(plaintext)>2*1024*1024)throw new Error('Protected credential payload is too large.');
   return plaintext;
  },
 };
}
