/* ==========================================================================
   Formulario de Google con el estilo de la web.
   Las respuestas se envían directamente al formulario de Google (formResponse), así que
   llegan a su hoja de respuestas como si se rellenara en Google Forms.
   Google no deja leer la respuesta del envío (modo no-cors): se da por enviado si no hay
   error de red. Siempre se ofrece además el botón para abrir el formulario original.
   ========================================================================== */
import { el } from './ui.js';
import { store } from './store.js';
import { trackEvent } from './analytics.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Campo según su tipo. Devuelve { node, get(), valid() } */
function fieldNode(f, i) {
  const id = `gf-${f.entry}-${i}`;
  const req = !!f.required;
  const label = el('span.gf-label', {}, f.label, req ? el('b.gf-req', { 'aria-hidden': 'true' }, ' *') : null);

  if (f.type === 'radio') {
    const name = `gf-${f.entry}`;
    const opts = el('div.gf-chips', { role: 'radiogroup', 'aria-required': req ? 'true' : null },
      // el valor enviado debe ser idéntico a la opción de Google; el texto visible se ordena
      f.options.map((o) => el('label.gf-chip', {},
        el('input', { type: 'radio', name, value: o, required: req }),
        el('span', {}, o.replace(/\s*-\s*/g, ' - ')))));
    const node = el('fieldset.gf-field' + (f.full ? '.full' : ''), {}, el('legend', {}, label), opts);
    return {
      node,
      get: () => (opts.querySelector('input:checked') || {}).value || '',
    };
  }
  const attrs = { id, required: req, autocomplete: 'off' };
  let input;
  if (f.type === 'date') input = el('input', { ...attrs, type: 'date', min: today() });
  else if (f.type === 'tel') input = el('input', { ...attrs, type: 'tel', autocomplete: 'tel', inputmode: 'tel', placeholder: '351 000-0000' });
  else if (f.type === 'number') input = el('input', { ...attrs, type: 'number', min: 1, max: 100, inputmode: 'numeric', placeholder: 'Ej.: 10' });
  else input = el('input', { ...attrs, type: 'text', autocomplete: /apellido/i.test(f.label) ? 'family-name' : /nombre/i.test(f.label) ? 'given-name' : 'off' });
  const node = el('label.gf-field' + (f.full ? '.full' : ''), { for: id }, label, input);
  return { node, get: () => input.value.trim() };
}

/** Datos para formResponse (las fechas van separadas en año, mes y día) */
function payload(fields, values) {
  const body = new URLSearchParams();
  fields.forEach((f, i) => {
    const v = values[i];
    if (!v) return;
    if (f.type === 'date') {
      const [y, m, d] = v.split('-');
      body.append(`entry.${f.entry}_year`, y);
      body.append(`entry.${f.entry}_month`, String(+m));
      body.append(`entry.${f.entry}_day`, String(+d));
    } else body.append(`entry.${f.entry}`, v);
  });
  return body;
}

export function renderGForm(b, ctx, { bindEditable, formDialog, btn }) {
  const site = (store.content && store.content.site) || {};
  const title = el('h2', {}, b.title || '');
  const intro = el('p.gf-intro', {}, b.intro || '');
  const fields = b.fields || [];
  const ctrls = fields.map(fieldNode);
  const submit = el('button.btn.gf-submit', { type: 'submit' }, b.submitText || 'Enviar reserva');
  const msg = el('div.form-msg', { hidden: true, role: 'status' });
  const form = el('form.gf-form', { novalidate: false },
    el('div.form-grid', {}, ctrls.map((c) => c.node)),
    el('div.gf-actions', {}, submit),
    msg);

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (ctx.editing) return;
    const values = ctrls.map((c) => c.get());
    const missing = fields.find((f, i) => f.required && !values[i]);
    if (missing) {
      msg.hidden = false;
      msg.className = 'form-msg err';
      msg.textContent = `Completa «${missing.label}».`;
      return;
    }
    submit.disabled = true;
    submit.textContent = 'Enviando…';
    try {
      await fetch(b.action, { method: 'POST', mode: 'no-cors', body: payload(fields, values) });
      form.reset();
      trackEvent('generate_lead', { formulario: 'reserva' }); // reserva enviada
      msg.hidden = false;
      msg.className = 'form-msg ok';
      msg.textContent = b.successText || '¡Recibido! Te contactaremos para confirmar tu reserva.';
      msg.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    } catch {
      msg.hidden = false;
      msg.className = 'form-msg err';
      msg.replaceChildren('No se pudo enviar. Revisa tu conexión o ',
        el('a', { href: b.url, target: '_blank', rel: 'noopener' }, 'completa el formulario de Google'), '.');
    } finally {
      submit.disabled = false;
      submit.textContent = b.submitText || 'Enviar reserva';
    }
  });

  // alternativas: formulario original de Google y WhatsApp
  const wa = String(site.whatsapp || '').replace(/[^\d]/g, '');
  const alt = el('div.gf-alt', {},
    el('span', {}, '¿Prefieres otra vía?'),
    b.url ? el('a.btn.secondary.small', { href: b.url, target: '_blank', rel: 'noopener' }, b.buttonText || 'Completar en Google Forms') : null,
    wa ? el('a.btn.ghost.small', { href: `https://wa.me/${wa}`, target: '_blank', rel: 'noopener' }, 'Escribir por WhatsApp') : null);

  const card = el('div.form-card.gf-card', {}, title, b.intro || ctx.editing ? intro : null, form, alt);

  if (ctx.editing) {
    bindEditable(title, b, 'title', ctx.changed, { placeholder: 'Título del formulario' });
    bindEditable(intro, b, 'intro', ctx.changed, { multiline: true, placeholder: 'Texto de introducción (opcional)' });
    bindEditable(submit, b, 'submitText', ctx.changed, { placeholder: 'Texto del botón' });
    form.querySelectorAll('input').forEach((i) => (i.disabled = true));
    card.append(el('div.edit-row', {},
      btn('Ajustes del formulario', async () => {
        const r = await formDialog({
          title: 'Formulario de Google',
          values: b,
          fields: [
            { key: 'url', label: 'Enlace del formulario de Google (viewform)', type: 'url' },
            { key: 'buttonText', label: 'Texto del botón que abre Google Forms' },
            { key: 'successText', label: 'Mensaje tras enviar', type: 'textarea', rows: 3 },
          ],
        });
        if (r) {
          Object.assign(b, r);
          b.action = (b.url || '').replace(/\/viewform.*$/, '/formResponse');
          ctx.changed();
          ctx.rerender();
        }
      }, 'ghost'),
      el('small', { style: { color: 'var(--muted)' } },
        'Las respuestas llegan a tu formulario de Google. Si cambias sus preguntas, hay que actualizar este bloque.')
    ));
  }
  return card;
}

/** Bloque por defecto, enlazado al formulario de reservas de Vikingo Paintball */
export const GFORM_DEFAULT = {
  type: 'gform',
  title: 'Reserva tu turno',
  intro: 'Completa el formulario y te contactamos para confirmar tu reserva.',
  url: 'https://docs.google.com/forms/d/e/1FAIpQLSfJdLBKzbN-lY-N5vv1k4hg_T4oryh_X7ppowVTlMBOZryaLg/viewform',
  action: 'https://docs.google.com/forms/d/e/1FAIpQLSfJdLBKzbN-lY-N5vv1k4hg_T4oryh_X7ppowVTlMBOZryaLg/formResponse',
  submitText: 'Enviar reserva',
  buttonText: 'Completar en Google Forms',
  successText: '¡Recibido, guerrero! Te contactaremos por teléfono o WhatsApp para confirmar tu turno.',
  fields: [
    { entry: 844778428, label: 'Día de reserva', type: 'date', required: true },
    { entry: 1727922417, label: '¿En qué horario te gustaría jugar?', type: 'radio', required: true, full: true,
      // textos idénticos a los del formulario de Google (incluidos sus espacios)
      options: ['09 - 10 hs', '10 - 11 hs', '11 - 12 hs', '12- 13 hs', '15 - 16 hs', '16 - 17 hs', '17 - 18 hs', '18 -19 hs'] },
    { entry: 627676165, label: 'Nombre', type: 'text', required: true },
    { entry: 1665717554, label: 'Apellido', type: 'text', required: true },
    { entry: 25269716, label: 'Número de teléfono', type: 'tel', required: true },
    { entry: 1982133080, label: '¿Cuántas personas juegan contigo?', type: 'number' },
    { entry: 709004155, label: '¿Reservas en representación de tu equipo?', type: 'radio', options: ['Sí', 'No'] },
    { entry: 962005889, label: '¿Has jugado antes?', type: 'radio', options: ['Sí', 'No'] },
    { entry: 287606259, label: '¿Traes tu propia marcadora?', type: 'radio', options: ['Sí', 'No'] },
  ],
};

