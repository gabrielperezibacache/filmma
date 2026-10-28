const form = document.querySelector('#pair'), status = document.querySelector('#status'), button = document.querySelector('#connect');
form.addEventListener('submit', async (event) => { event.preventDefault(); button.disabled = true; status.textContent = 'Comprobando código local…'; try {
    const response = await chrome.runtime.sendMessage({ type: 'pair', endpoint: document.querySelector('#endpoint').value, code: document.querySelector('#code').value.trim() });
    if (!response?.ok)
        throw Error(response?.error || 'No se pudo enlazar.');
    document.querySelector('#code').value = '';
    status.textContent = 'Chrome enlazado. Vuelve a Filmma → Dirección → Generar → Google AI Pro.';
}
catch (e) {
    status.textContent = e.message;
}
finally {
    button.disabled = false;
} });
chrome.storage.local.get('connection').then(({ connection }) => { if (connection)
    status.textContent = 'Existe un enlace local. Puedes crear otro código en Filmma para reemplazarlo.'; });
