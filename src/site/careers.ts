// Role pages and the application form.
//
// Every "Apply" on the careers index used to point at /contact#tsc-contact-form
// — the same generic form for all fourteen roles, with no field for a CV, no
// portfolio link, and nothing recording WHICH role the person wanted. Whoever
// read the inbox had to guess.
//
// So each role gets its own page: the title, the terms and the description it
// already had on the index, then a form that asks for exactly what Bam asked
// for — name, email, phone, an optional link to their work, and a track record
// as either an uploaded document or a written blurb.
//
// The role list lives HERE rather than being scraped out of the index page at
// request time. Parsing prose to find a job title is the kind of thing that
// works until someone edits a heading; a typed list cannot silently lose a
// role, and the index's links are rewritten to match it.

export interface Role {
  slug: string;
  title: string;
  /** The line under the title: seniority, commitment, location. */
  terms: string;
  /** What the job is, in the words already on the careers page. */
  blurb: string;
}

export const ROLES: Role[] = [
  { slug: 'operating-partner', title: 'Operating Partner',
    terms: 'Senior · Equity considered · Philadelphia preferred',
    blurb: 'Someone to carry the day-to-day with me — operations, hiring, the parts of the business that need an owner rather than a task list.' },
  { slug: 'head-of-brand', title: 'Head of Brand',
    terms: 'Senior · Part-time or full · Remote / Philadelphia',
    blurb: 'Owning what the label says and how it says it, across every surface. Editorial instinct over campaign management.' },
  { slug: 'models', title: 'Models',
    terms: 'Freelance · Per shoot · Philadelphia + remote submissions',
    blurb: 'Ongoing casting for campaign, lookbook and product photography. All sizes, all ages. Submissions stay on file.' },
  { slug: 'creative-direction', title: 'Creative Direction',
    terms: 'Freelance · Per season · Remote / Philadelphia',
    blurb: 'Setting the look of a season and holding it together across shoots, print and the site.' },
  { slug: 'brand-design', title: 'Brand Design',
    terms: 'Freelance · Project · Remote',
    blurb: 'Layout, type, packaging and the parts of the identity that get used every day rather than admired once.' },
  { slug: 'photo-video', title: 'Photo & Video',
    terms: 'Freelance · Per shoot · Philadelphia preferred',
    blurb: 'Campaign, lookbook and product work. Someone who can light a garment properly and cut their own footage.' },
  { slug: 'marketing-generalist', title: 'Marketing Generalist',
    terms: 'Part-time · Contract · Remote / Philadelphia',
    blurb: 'Campaign planning, email, paid and the reporting that says whether any of it worked.' },
  { slug: 'content-social', title: 'Content & Social',
    terms: 'Freelance · Philadelphia preferred',
    blurb: 'Shooting, cutting and posting. Someone with their own voice who can hold ours.' },
  { slug: 'pop-up-producer', title: 'Pop-Up Producer',
    terms: 'Freelance · Per event · Philadelphia + travel',
    blurb: 'Finding the space, negotiating it, and running the build through to the doors opening.' },
  { slug: 'retail-event-staff', title: 'Retail & Event Staff',
    terms: 'Casual · Per event · Philadelphia',
    blurb: 'Working the floor at pop-ups and events. Selling, folding, and talking to people properly.' },
  { slug: 'build-install', title: 'Build & Install',
    terms: 'Freelance · Per event · Philadelphia',
    blurb: 'Fixtures, rails, signage and the physical build of a space. Hands-on trades welcome.' },
  { slug: 'partnerships-collaborations', title: 'Partnerships & Collaborations',
    terms: 'Part-time · Contract · Remote',
    blurb: 'Sourcing and running collaborations that are worth doing, and saying no to the ones that are not.' },
  { slug: 'wholesale-stockists', title: 'Wholesale & Stockists',
    terms: 'Commission · Remote',
    blurb: 'Getting the label into the right rooms. Existing relationships matter more than a deck.' },
  { slug: 'open-application', title: 'Open — tell us what you do',
    terms: 'Expression of interest · Remote',
    blurb: 'We know we will need help here that is not on this list yet. Tell us what you do and how you would use it.' },
];

export const roleBySlug = (slug: string): Role | undefined =>
  ROLES.find((r) => r.slug === slug);

/** Where applications go. */
export const CAREERS_INBOX = process.env.CAREERS_INBOX ?? '';

/** Upload ceiling. Generous for a CV, small enough that it cannot be abused. */
export const CV_MAX_BYTES = 5 * 1024 * 1024;
export const CV_TYPES = ['application/pdf', 'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'text/plain', 'application/rtf'];

const esc = (s: string): string =>
  String(s).replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));

export const CAREERS_CSS = `
.rl{max-width:720px;margin:0 auto;padding:8px 0 70px}
.rl__back{display:inline-block;margin-bottom:26px;font-size:12px;letter-spacing:.06em;
  text-transform:uppercase;color:var(--tx2,#666);text-decoration:none}
.rl__back:hover{color:var(--tx,#111)}
.rl__terms{font-size:12px;letter-spacing:.05em;text-transform:uppercase;color:var(--tx3,#999);margin-bottom:10px}
.rl__title{font-size:34px;font-weight:700;letter-spacing:-.02em;line-height:1.1;margin:0 0 16px;text-wrap:balance}
.rl__blurb{font-size:16px;line-height:1.65;color:var(--tx2,#444);margin:0 0 34px}
.rl__form{border-top:1px solid var(--bd,rgba(0,0,0,.12));padding-top:30px;
  display:flex;flex-direction:column;gap:18px}
.rl__h2{font-size:13px;font-weight:700;letter-spacing:.07em;text-transform:uppercase;margin:0}
.rl__f{display:flex;flex-direction:column;gap:7px}
.rl__f label{font-size:12px;font-weight:600;letter-spacing:.04em;color:var(--tx2,#444);margin:0}
.rl__f .opt{color:var(--tx3,#999);font-weight:400;letter-spacing:0;text-transform:none}
.rl__f input,.rl__f textarea{width:100%;box-sizing:border-box;padding:13px 15px;font:inherit;font-size:15px;
  border:1px solid var(--bd2,rgba(0,0,0,.18));border-radius:9px;background:var(--sf,#fff);color:inherit}
.rl__f textarea{min-height:150px;resize:vertical;line-height:1.6}
.rl__f input:focus,.rl__f textarea:focus{outline:0;border-color:var(--tx,#111);box-shadow:0 0 0 3px rgba(0,0,0,.06)}
.rl__row{display:grid;grid-template-columns:1fr 1fr;gap:14px}
@media(max-width:560px){.rl__row{grid-template-columns:1fr}}
/* Two ways to give a track record, one at a time — a form that shows an
   upload AND a long textarea implies both are wanted. */
.rl__seg{display:flex;gap:6px;padding:4px;background:var(--sf2,#f4f4f5);border-radius:10px;width:fit-content}
.rl__segb{border:0;background:none;padding:8px 15px;border-radius:7px;font:inherit;font-size:13px;
  font-weight:600;color:var(--tx2,#555);cursor:pointer}
.rl__segb.on{background:var(--sf,#fff);color:var(--tx,#111);box-shadow:0 1px 3px rgba(0,0,0,.12)}
.rl__drop{border:1.5px dashed var(--bd2,rgba(0,0,0,.22));border-radius:11px;padding:26px 20px;text-align:center;
  cursor:pointer;transition:border-color .16s ease,background .16s ease}
.rl__drop:hover,.rl__drop.over{border-color:var(--tx,#111);background:var(--sf2,#fafafa)}
.rl__drop input{display:none}
.rl__dropt{font-size:14px;font-weight:600}
.rl__drops{font-size:12px;color:var(--tx3,#999);margin-top:5px}
.rl__file{display:flex;align-items:center;gap:10px;justify-content:center;font-size:13px}
.rl__file button{border:0;background:none;color:var(--err,#b42318);font:inherit;font-size:12px;
  text-decoration:underline;cursor:pointer;padding:0}
.rl__send{align-self:flex-start;padding:16px 40px;border:0;border-radius:0;background:var(--tx,#111);color:#fff;
  font:inherit;font-size:12px;font-weight:600;letter-spacing:.07em;text-transform:uppercase;cursor:pointer}
.rl__send:disabled{opacity:.45;cursor:default}
.rl__msg{font-size:14px;line-height:1.55;margin:0}
.rl__msg--err{color:var(--err,#b42318)}
.rl__done{border:1px solid var(--bd,rgba(0,0,0,.12));border-radius:12px;padding:34px;text-align:center}
.rl__done h2{margin:0 0 8px;font-size:20px}
.rl__done p{margin:0;color:var(--tx2,#666);font-size:14px;line-height:1.6}
`;

export function rolePage(role: Role): string {
  return `
<div class="rl">
  <a class="rl__back" href="/careers">← All roles</a>
  <div class="rl__terms">${esc(role.terms)}</div>
  <h1 class="rl__title">${esc(role.title)}</h1>
  <p class="rl__blurb">${esc(role.blurb)}</p>

  <form class="rl__form" id="rl-form" novalidate>
    <input type="hidden" name="role" value="${esc(role.title)}">
    <input type="hidden" name="roleSlug" value="${esc(role.slug)}">
    <h2 class="rl__h2">Apply</h2>

    <div class="rl__row">
      <div class="rl__f"><label for="rl-name">Your name</label>
        <input id="rl-name" name="name" autocomplete="name" required></div>
      <div class="rl__f"><label for="rl-email">Email</label>
        <input id="rl-email" name="email" type="email" autocomplete="email" required></div>
    </div>
    <div class="rl__row">
      <div class="rl__f"><label for="rl-phone">Phone</label>
        <input id="rl-phone" name="phone" type="tel" autocomplete="tel" required></div>
      <div class="rl__f"><label for="rl-link">Link to your work <span class="opt">— optional</span></label>
        <input id="rl-link" name="link" type="url" placeholder="https://" autocomplete="url"></div>
    </div>

    <div class="rl__f">
      <label>Track record</label>
      <div class="rl__seg" role="tablist">
        <button type="button" class="rl__segb on" data-mode="file" role="tab" aria-selected="true">Upload a document</button>
        <button type="button" class="rl__segb" data-mode="text" role="tab" aria-selected="false">Write a blurb</button>
      </div>

      <label class="rl__drop" id="rl-drop">
        <input type="file" id="rl-file" name="cv" accept=".pdf,.doc,.docx,.txt,.rtf">
        <span id="rl-dropbody">
          <span class="rl__dropt">Drop your CV here, or choose a file</span>
          <span class="rl__drops">PDF, DOC, DOCX, TXT or RTF · up to 5MB</span>
        </span>
      </label>

      <textarea id="rl-about" name="about" hidden
        placeholder="Tell us what you have done and how you would use it here."></textarea>
    </div>

    <button class="rl__send" type="submit" id="rl-send">Send application</button>
    <p class="rl__msg" id="rl-msg"></p>
  </form>
</div>`;
}

export const CAREERS_RUNTIME = `
(function(){
  var form = document.getElementById('rl-form');
  if (!form) return;
  var drop = document.getElementById('rl-drop');
  var file = document.getElementById('rl-file');
  var body = document.getElementById('rl-dropbody');
  var about = document.getElementById('rl-about');
  var msg = document.getElementById('rl-msg');
  var send = document.getElementById('rl-send');
  var MAX = ${CV_MAX_BYTES};

  function say(t, bad){ msg.textContent = t || ''; msg.className = 'rl__msg' + (bad ? ' rl__msg--err' : ''); }

  // One or the other, never both on screen: showing an upload AND a long
  // textarea reads as a request for two things.
  form.querySelectorAll('[data-mode]').forEach(function(b){
    b.addEventListener('click', function(){
      var mode = b.getAttribute('data-mode');
      form.querySelectorAll('[data-mode]').forEach(function(x){
        var on = x === b;
        x.classList.toggle('on', on);
        x.setAttribute('aria-selected', String(on));
      });
      drop.hidden = mode !== 'file';
      about.hidden = mode !== 'text';
      if (mode === 'text') about.focus();
    });
  });

  function showFile(f){
    if (!f) { body.innerHTML = '<span class="rl__dropt">Drop your CV here, or choose a file</span>'
      + '<span class="rl__drops">PDF, DOC, DOCX, TXT or RTF · up to 5MB</span>'; return; }
    body.innerHTML = '<span class="rl__file"><span>' + f.name.replace(/[<>&]/g,'') + ' · '
      + Math.max(1, Math.round(f.size/1024)) + 'KB</span>'
      + '<button type="button" data-clear>Remove</button></span>';
  }
  file.addEventListener('change', function(){
    var f = file.files[0];
    if (f && f.size > MAX) { say('That file is over 5MB. Send a link instead, or write a blurb.', true); file.value=''; return; }
    say(''); showFile(f);
  });
  drop.addEventListener('click', function(e){ if (e.target.closest('[data-clear]')) { e.preventDefault(); file.value=''; showFile(null); } });
  ['dragenter','dragover'].forEach(function(t){ drop.addEventListener(t, function(e){ e.preventDefault(); drop.classList.add('over'); }); });
  ['dragleave','drop'].forEach(function(t){ drop.addEventListener(t, function(e){ e.preventDefault(); drop.classList.remove('over'); }); });
  drop.addEventListener('drop', function(e){
    var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (!f) return;
    if (f.size > MAX) return say('That file is over 5MB. Send a link instead, or write a blurb.', true);
    var dt = new DataTransfer(); dt.items.add(f); file.files = dt.files; showFile(f); say('');
  });

  form.addEventListener('submit', async function(e){
    e.preventDefault();
    var fd = new FormData(form);
    var name = (fd.get('name')||'').trim(), email = (fd.get('email')||'').trim(), phone = (fd.get('phone')||'').trim();
    if (!name) return say('Add your name.', true);
    if (!email || email.indexOf('@') < 1) return say('Add an email we can reply to.', true);
    if (!phone) return say('Add a phone number.', true);
    var hasFile = file.files && file.files[0];
    var hasText = (fd.get('about')||'').trim().length > 20;
    if (!hasFile && !hasText) return say('Upload a document or write a few lines about yourself.', true);

    send.disabled = true; send.textContent = 'Sending…'; say('');
    try {
      var res = await fetch('/api/careers/apply', { method: 'POST', body: fd });
      var out = await res.json().catch(function(){ return {}; });
      if (!res.ok) throw new Error((out.error && out.error.message) || 'That did not send.');
      form.innerHTML = '<div class="rl__done"><h2>Application sent</h2>'
        + '<p>Thanks — we have it. If it is a fit we will come back to you at ' + email.replace(/[<>&]/g,'') + '.</p></div>';
    } catch (err) {
      send.disabled = false; send.textContent = 'Send application';
      say(err.message || 'That did not send. Try again in a moment.', true);
    }
  });
})();
`;
