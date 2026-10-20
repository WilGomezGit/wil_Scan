// Enviar archivos por WhatsApp, correo, Telegram, Discord…
// En el móvil (y en la app de Android) se abre la hoja de compartir del sistema, que lista todas las apps instaladas.
// En un ordenador sin esa hoja, el archivo se guarda y se ofrecen accesos directos a esas aplicaciones para adjuntarlo.
import { h, icon, openSheet, toast } from '../lib/dom.js';
import { deliver, isNative } from '../core/share.js';

const APPS = [
  { name: 'WhatsApp', note: 'WhatsApp Web', url: () => 'https://web.whatsapp.com/' },
  { name: 'Telegram', note: 'Telegram Web', url: () => 'https://web.telegram.org/' },
  { name: 'Discord', note: 'Discord', url: () => 'https://discord.com/channels/@me' },
  { name: 'Gmail', note: 'Redactar un correo', url: (t) => 'https://mail.google.com/mail/?view=cm&fs=1&su=' + encodeURIComponent(t) + '&body=' + encodeURIComponent('Te envío «' + t + '» (escaneado con WilScan).') },
  { name: 'Correo del equipo', note: 'App de correo predeterminada', url: (t) => 'mailto:?subject=' + encodeURIComponent(t) + '&body=' + encodeURIComponent('Te envío «' + t + '» (escaneado con WilScan).') },
];

// Igual que deliver(), pero si solo se pudo descargar tras pedir «Compartir», explica cómo enviarlo
export async function sendFiles(files, { mode = 'share', title = '' } = {}) {
  const r = await deliver(files, { mode, title });
  if (r === 'downloaded') {
    if (mode === 'share') openSendHelp(files, title);
    else toast('Guardado en tus descargas', 'ok');
  }
  return r;
}

export function openSendHelp(files, title = '') {
  const t = title || (files[0] && files[0].name) || 'Documento';
  const names = files.map((f) => f.name).join(', ');
  const open = (app) => { window.open(app.url(t), '_blank', 'noopener'); };
  const list = h('div', { class: 'send-apps' }, APPS.map((a) => h('button', { class: 'send-app', attrs: { type: 'button' }, on: { click: () => open(a) } }, h('span', { class: 'send-ic', text: a.name[0] }), h('span', { class: 'send-tx' }, h('b', { text: a.name }), h('small', { text: a.note })), icon('next', 's'))));
  openSheet({ title: 'Enviar el archivo', body: h('div', {}, h('p', { class: 'ok-line' }, icon('check', 's'), ' Archivo guardado en tus descargas'), h('p', { class: 'hint first', text: `«${names}». Este navegador no tiene hoja de compartir: abre la aplicación que prefieras y adjunta o arrastra el archivo.` }), list, h('p', { class: 'hint', text: isNative() ? '' : 'En el móvil, el botón Compartir abre directamente WhatsApp, Telegram, Discord, el correo y el resto de tus apps.' })) });
}
