const form = document.querySelector('#pair'), status = document.querySelector('#status'), button = document.querySelector('#connect');
form.addEventListener('submit', async (event) => { event.preventDefault(); button.disabled = true; status.textContent = 'Comprobando código local…'; try {
    const response = await chrome.runtime.sendMessage({ type: 'pair', endpoint: document.querySelector('#endpoint').value, code: document.querySelector('#code').value.trim() });
    if (!response?.ok)
        throw Error(response?.error || 'No se pudo enlazar.');
    const health=await chrome.runtime.sendMessage({type:'status'});if(!health?.connected||!health.endpoint)throw Error(health?.error||'Recarga la extensión 0.1.2 y vuelve a comprobar el enlace.');
    document.querySelector('#code').value = '';
    status.textContent = 'Chrome conectado con '+health.endpoint+'. Vuelve a Filmma → Dirección → Generar → Google AI Pro.';
}
catch (e) {
    status.textContent = e.message;
}
finally {
    button.disabled = false;
} });
async function checkConnection(){
 button.disabled=true;status.textContent='Comprobando el enlace real con Filmma…';
 try{const result=await chrome.runtime.sendMessage({type:'status'});if(result.endpoint)document.querySelector('#endpoint').value=result.endpoint;if(result.connected)status.textContent='Chrome conectado con '+result.endpoint+'. Tu sesión de Google permanece en Chrome.';else status.textContent=(result.error||'Aún no hay un enlace activo.')+' Abre Filmma en el mismo puerto, crea otro código y enlaza de nuevo.'}catch(error){status.textContent='No se pudo comprobar el enlace. Recarga esta extensión y vuelve a intentarlo.'}finally{button.disabled=false}
}
document.querySelector('#check').addEventListener('click',()=>void checkConnection());void checkConnection();
