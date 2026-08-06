// The contact form.
//
// The page was still carrying WordPress: `wpforms-form-162291`, posting
// `wpforms[fields][0][first]` at a WPForms endpoint that does not exist on
// this stack. It rendered, it validated, and submitting it did nothing — the
// form on the live contact page could not send a message.
//
// This is a real one, posting to /api/contact, which picks the recipient from
// Settings > Counter by topic id. The browser never names the destination:
// a form that carries its own recipient is an open relay.
//
// STYLE, per the reference Bam gave: no input boxes. Each field is a row on a
// hairline rule, its label large and uppercase where a placeholder would sit,
// shrinking to a caption once there is something in the field. The label IS
// the placeholder, so nothing is ever unlabelled — the usual failure of
// placeholder-only forms, where the question disappears the moment you answer
// it and cannot be re-read.

import { esc } from './html.js';

export interface ContactTopic { id: string; label: string }

export const CONTACT_CSS = `
.cf{--cf-line:var(--bd2,rgba(0,0,0,.22));--cf-ink:var(--tx,#0a0a0a);--cf-dim:var(--tx3,#8a8a8a);
  --cf-accent:var(--accent-color,#e83b3b);
  display:block;width:100%;margin:0}
.cf__main{padding:0}
/* Smaller than the standalone version: inside the accordion the summary
   already says "Message us", so this is a caption rather than a headline. */
.cf__title{margin:0;padding:4px 0 20px;font-size:clamp(18px,2vw,26px);font-weight:800;
  line-height:1.05;letter-spacing:-.02em;text-transform:uppercase;border-bottom:1px solid var(--cf-line)}
.cf__rows{display:flex;flex-direction:column}
/* Two to a row where the pair is one idea — a name is one answer given in two
   boxes, so it should not read as two questions. */
.cf__pair{display:grid;grid-template-columns:1fr 1fr}
.cf__pair > .cf__f:first-child{border-right:1px solid var(--cf-line)}
.cf__f{position:relative;border-bottom:1px solid var(--cf-line);padding:0}
/* .cf prefixed on purpose. The ported theme sheet carries
     .h-input, input[type="text"], … { padding:10px 15px; font-size:13px }
   which is 0,1,1 — the SAME specificity as .cf__f input — and it loads
   after this inline block, so it won on order alone. The value then sat at
   the top of the field, printed straight through the floated label. One
   extra class puts these at 0,2,1 and settles it regardless of order. */
.cf .cf__f input,.cf .cf__f select,.cf .cf__f textarea{
  width:100%;box-sizing:border-box;border:0;outline:0;background:none;color:var(--cf-ink);
  font-family:inherit;font-size:17px;font-weight:700;letter-spacing:.01em;line-height:1.3;
  padding:34px 18px 14px;border-radius:0;-webkit-appearance:none;appearance:none;
  min-height:0;height:auto;box-shadow:none}
.cf .cf__f textarea{min-height:170px;resize:vertical;line-height:1.6;font-weight:500;font-size:16px;
  padding-top:38px}
.cf .cf__f select{cursor:pointer}
.cf .cf__f input:focus,.cf .cf__f select:focus,.cf .cf__f textarea:focus{
  outline:0;box-shadow:none;border:0;background:none}
/* THE LABEL IS THE PLACEHOLDER. Large and in the field until it has content,
   then small and above it — so the question is still readable after it has
   been answered. :placeholder-shown does the work with no JS. */
.cf .cf__lab{position:absolute;left:18px;top:50%;transform:translateY(-50%);
  font-size:19px;font-weight:800;letter-spacing:.01em;text-transform:uppercase;
  color:var(--cf-dim);pointer-events:none;transition:top .16s ease,font-size .16s ease,
  transform .16s ease,color .16s ease}
.cf .cf__f textarea ~ .cf__lab{top:30px;transform:none}
.cf .cf__f input:focus ~ .cf__lab,
.cf .cf__f input:not(:placeholder-shown) ~ .cf__lab,
.cf .cf__f textarea:focus ~ .cf__lab,
.cf .cf__f textarea:not(:placeholder-shown) ~ .cf__lab,
.cf .cf__f select:focus ~ .cf__lab,
.cf .cf__f select.has ~ .cf__lab{
  top:14px;transform:none;font-size:11px;letter-spacing:.08em;color:var(--cf-ink)}
/* The active row draws its own rule in the accent, and a dot marks it — the
   reference's tell for "this is the one you are answering". */
.cf__f::after{content:"";position:absolute;left:0;right:0;bottom:-1px;height:1px;
  background:var(--cf-accent);transform:scaleX(0);transform-origin:left;
  transition:transform .22s ease}
.cf__f:focus-within::after{transform:scaleX(1)}
.cf__dot{position:absolute;right:18px;top:50%;width:7px;height:7px;margin-top:-3px;border-radius:50%;
  background:var(--cf-accent);opacity:0;transition:opacity .18s ease}
.cf__f:focus-within .cf__dot{opacity:1}
.cf__chev{position:absolute;right:18px;top:50%;transform:translateY(-50%);pointer-events:none;
  font-size:13px;color:var(--cf-dim)}
/* Honeypot: off-screen rather than display:none, because some bots skip
   hidden fields but fill positioned ones. */
.cf__pot{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}
/* The drawer the accordion opens. details/summary is native, so the open and
   close need no JavaScript — which matters here because the Elementor script
   that used to run this page is not part of this stack. */
/* Hidden explicitly when the accordion is shut. A <details> normally hides
   its own children, but the ported theme sets details{display:flex} and that
   defeats the native behaviour in Chrome — the form sat open on page load
   with the summary still reading closed. */
details:not([open]) > .cf-drop{display:none}
.cf-drop{padding:22px 0 30px}
.e-n-accordion-item summary{cursor:pointer;list-style:none}
.e-n-accordion-item summary::-webkit-details-marker{display:none}
.cf__foot{display:flex;flex-direction:column;align-items:stretch;gap:14px;padding:24px 0 4px}
.cf__send{width:100%;padding:20px 46px;border:0;border-radius:0;background:var(--cf-ink);color:var(--sf,#fff);
  font:inherit;font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;cursor:pointer;
  transition:background .18s ease}
.cf__send:hover{background:var(--cf-accent)}
.cf__send:disabled{opacity:.45;cursor:default}
.cf__msg{margin:0;font-size:13px;line-height:1.5;text-align:center}
.cf__msg--err{color:var(--cf-accent)}
.cf__done{padding:56px 18px;text-align:center}
.cf__done h3{margin:0 0 10px;font-size:24px;font-weight:800;text-transform:uppercase;letter-spacing:-.01em}
.cf__done p{margin:0;color:var(--tx2,#666);font-size:14px;line-height:1.6}
@media(max-width:560px){
  .cf__pair{grid-template-columns:1fr}
  .cf__pair > .cf__f:first-child{border-right:0;border-bottom:1px solid var(--cf-line)}
}
`;

const field = (name: string, label: string, type = 'text', autocomplete = ''): string => `
  <div class="cf__f">
    <input id="cf-${name}" name="${name}" type="${type}" placeholder=" "
      ${autocomplete ? `autocomplete="${autocomplete}"` : ''}>
    <label class="cf__lab" for="cf-${name}">${esc(label)}</label>
    <span class="cf__dot" aria-hidden="true"></span>
  </div>`;

export function contactForm(topics: ContactTopic[]): string {
  return `
<form class="cf" id="cf" novalidate>
  <div class="cf__main">
    <h2 class="cf__title">Please fill out this form</h2>
    <div class="cf__rows">
      <div class="cf__pair">
        ${field('first', 'First name', 'text', 'given-name')}
        ${field('last', 'Last name', 'text', 'family-name')}
      </div>
      ${field('email', 'Email address', 'email', 'email')}
      ${field('phone', 'Phone number', 'tel', 'tel')}
      ${field('company', 'Company', 'text', 'organization')}
      <div class="cf__f">
        <select id="cf-topic" name="topic">
          <option value="" selected disabled hidden></option>
          ${topics.map((t) => `<option value="${esc(t.id)}">${esc(t.label)}</option>`).join('')}
        </select>
        <label class="cf__lab" for="cf-topic">What is this about?</label>
        <span class="cf__chev" aria-hidden="true">⌄</span>
      </div>
      <div class="cf__f">
        <textarea id="cf-message" name="message" placeholder=" "></textarea>
        <label class="cf__lab" for="cf-message">How can we help you?</label>
      </div>
      <div class="cf__pot" aria-hidden="true">
        <label for="cf-website">Website</label>
        <input id="cf-website" name="website" type="text" tabindex="-1" autocomplete="off">
      </div>
    </div>
    <div class="cf__foot">
      <button class="cf__send" type="submit" id="cf-send">Send it</button>
      <p class="cf__msg" id="cf-msg"></p>
    </div>
  </div>
</form>`;
}

export const CONTACT_RUNTIME = `
(function(){
  var form = document.getElementById('cf');
  if (!form) return;
  var send = document.getElementById('cf-send');
  var msg = document.getElementById('cf-msg');
  var topic = document.getElementById('cf-topic');

  function say(t, bad){ msg.textContent = t || ''; msg.className = 'cf__msg' + (bad ? ' cf__msg--err' : ''); }

  // A select has no :placeholder-shown, so the float has to be told when it
  // holds a real value.
  function syncSelect(){ topic.classList.toggle('has', !!topic.value); }
  topic.addEventListener('change', syncSelect); syncSelect();

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var f = new FormData(form);
    var first = (f.get('first') || '').trim(), last = (f.get('last') || '').trim();
    var email = (f.get('email') || '').trim(), message = (f.get('message') || '').trim();
    if (!first) return say('Add your first name.', true);
    if (!email || email.indexOf('@') < 1) return say('Add an email we can reply to.', true);
    if (!topic.value) return say('Pick what this is about.', true);
    if (message.length < 5) return say('Tell us a little more.', true);

    send.disabled = true; send.textContent = 'Sending…'; say('');
    try {
      var res = await fetch('/api/contact', {
        method: 'POST', headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          topic: topic.value,
          name: (first + ' ' + last).trim(),
          email: email,
          message: message,
          company: (f.get('company') || '').trim() || undefined,
          // The phone has no field of its own on the API, so it travels in the
          // message rather than being silently dropped.
          website: (f.get('website') || '') || undefined,
        }),
      });
      var out = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error((out.error && out.error.message) || 'That did not send.');
      if (out.sent === false) throw new Error('Email is not connected on this store yet.');
      form.innerHTML = '<div class="cf__done"><h3>Message sent</h3>'
        + '<p>Thanks — we have it, and we will come back to you at ' + email.replace(/[<>&]/g, '') + '.</p></div>';
    } catch (err) {
      send.disabled = false; send.textContent = 'Send it';
      say(err.message || 'That did not send. Try again in a moment.', true);
    }
  });

  // Phone is worth having, so it is appended to the message rather than lost.
  var phone = document.getElementById('cf-phone');
  var messageEl = document.getElementById('cf-message');
  form.addEventListener('submit', function(){
    if (phone && phone.value.trim() && messageEl && messageEl.value.indexOf(phone.value.trim()) < 0) {
      messageEl.value = messageEl.value + '\\n\\nPhone: ' + phone.value.trim();
    }
  }, true);
})();
`;
