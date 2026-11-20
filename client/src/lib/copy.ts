/** Copia al portapapeles y avisa del resultado; el portapapeles puede estar bloqueado por el navegador. */
export async function copyText(text: string, notify: (message: string, kind: 'ok' | 'error') => void, done = 'Copiado.'): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
    notify(done, 'ok');
  } catch {
    notify('El navegador no permitió copiar. Selecciona el texto y cópialo a mano.', 'error');
  }
}
