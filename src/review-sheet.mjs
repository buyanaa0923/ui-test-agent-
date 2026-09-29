// Review sheet for independent labelling: a self-contained HTML page (no server, no network) and a CSV template.
// It deliberately shows NO model verdicts, so labellers are not anchored by Jev or Claude.
import { toCsv } from './agreement.mjs';

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const TEMPLATE_COLUMNS = ['id', 'rule', 'page', 'element', 'text', 'measured', 'label', 'notes'];
export function buildTemplateCsv(records) {
  return toCsv(records.map((r) => ({ id: r.id, rule: r.finding.rule, page: r.source.pages[0], element: r.finding.element, text: r.finding.text || '', measured: Object.values(r.source.detailByMode).join(' | '), label: '', notes: '' })), TEMPLATE_COLUMNS);
}

// assets: { [id]: { src, width, height } | null } - relative image path and its natural size, when a screenshot is available.
function figure(r, a) {
  if (!a) return '<div class="noimg">no screenshot</div>';
  const rect = r.source.rect;
  if (rect && a.width) {
    const pad = 24, z = rect.w < 260 ? 2 : 1;
    const x = Math.max(0, rect.x - pad), y = Math.max(0, rect.y - pad);
    const w = Math.min(a.width - x, rect.w + 2 * pad), h = rect.h + 2 * pad;
    return `<div class="crop" style="width:${Math.round(Math.min(w * z, 640))}px;height:${Math.round(h * z)}px;background-image:url('${esc(a.src)}');background-size:${a.width * z}px auto;background-position:-${Math.round(x * z)}px -${Math.round(y * z)}px"><i style="left:${Math.round((rect.x - x) * z)}px;top:${Math.round((rect.y - y) * z)}px;width:${Math.round(rect.w * z)}px;height:${Math.round(rect.h * z)}px"></i></div><a class="full" href="${esc(a.src)}" target="_blank">full screenshot</a>`;
  }
  return `<a href="${esc(a.src)}" target="_blank"><img class="step" src="${esc(a.src)}" alt="screenshot"></a>`;
}

export function buildSheetHtml(records, assets = {}, { title = 'UI findings: independent review' } = {}) {
  const cards = records.map((r, i) => `
<section class="card" data-id="${esc(r.id)}">
  <h3>${i + 1}. <code>${esc(r.id)}</code> <span class="tag">${esc(r.finding.rule)}</span> <span class="tag sev">${esc(r.finding.severity || '')}</span></h3>
  <div class="grid">
    <div>${figure(r, assets[r.id] || null)}</div>
    <div class="facts">
      <p><b>Measured:</b> ${esc(Object.entries(r.source.detailByMode).map(([m, d]) => `${m}: ${d}`).join('  |  '))}</p>
      <p><b>Element:</b> <code>${esc(r.finding.element)}</code>${r.finding.text ? ` &middot; text: <q>${esc(r.finding.text)}</q>` : ''}</p>
      <p><b>Seen on:</b> ${esc(r.source.pages.slice(0, 3).join(', '))}${r.source.pages.length > 3 ? ` (+${r.source.pages.length - 3} more)` : ''}</p>
      <div class="choices">
        <label><input type="radio" name="l-${esc(r.id)}" value="real"> Real defect</label>
        <label><input type="radio" name="l-${esc(r.id)}" value="false_positive"> Not a defect</label>
        <label><input type="radio" name="l-${esc(r.id)}" value="unsure"> Unsure</label>
      </div>
      <textarea placeholder="Notes (optional): why?" rows="2"></textarea>
    </div>
  </div>
</section>`).join('\n');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>
:root{--bg:#f7f8fa;--fg:#14171c;--muted:#5b6472;--card:#fff;--line:#d9dee6;--accent:#00796b}
@media (prefers-color-scheme:dark){:root{--bg:#0f1216;--fg:#e8ebf0;--muted:#98a2b3;--card:#171b21;--line:#2b323c;--accent:#4db6a8}}
body{margin:0;background:var(--bg);color:var(--fg);font:15px/1.5 system-ui,sans-serif}
main{max-width:1000px;margin:0 auto;padding:16px}
header.top{position:sticky;top:0;background:var(--bg);border-bottom:1px solid var(--line);padding:10px 16px;z-index:5;display:flex;gap:16px;align-items:center;flex-wrap:wrap}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;margin:14px 0}
.card.done{border-left:4px solid var(--accent)}
h3{margin:0 0 8px;font-size:15px}code{font-size:13px}.tag{font-size:12px;padding:1px 8px;border:1px solid var(--line);border-radius:99px;color:var(--muted)}
.grid{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:16px}@media(max-width:720px){.grid{grid-template-columns:1fr}}
.crop{position:relative;border:1px solid var(--line);background-repeat:no-repeat;max-width:100%}.crop i{position:absolute;outline:2px solid #e53935;outline-offset:1px}
.step{max-width:100%;border:1px solid var(--line)}.noimg{color:var(--muted)}.full{display:block;font-size:12px;margin-top:4px;color:var(--accent)}
.choices{display:flex;gap:14px;flex-wrap:wrap;margin:10px 0}textarea{width:100%;box-sizing:border-box;background:var(--bg);color:var(--fg);border:1px solid var(--line);border-radius:6px;padding:6px}
button,input[type=text]{font:inherit;padding:6px 10px;border-radius:6px;border:1px solid var(--line);background:var(--card);color:var(--fg)}button{cursor:pointer;background:var(--accent);color:#fff;border-color:var(--accent)}
.hint{color:var(--muted);font-size:13px;margin:4px 0 0}
</style></head><body>
<header class="top">
  <label>Your name: <input type="text" id="who" placeholder="e.g. bat"></label>
  <span id="progress">0 / ${records.length} labelled</span>
  <button id="save" type="button">Download my labels (CSV)</button>
</header>
<main>
  <h1 style="font-size:20px">${esc(title)}</h1>
  <p class="hint"><b>Label alone, before you discuss anything with the other reviewer.</b> For each finding decide: would a designer or QA reviewer want this fixed?
  <b>Real defect</b> = it affects users or breaks the design system. <b>Not a defect</b> = intentional, exempt, decorative/hidden, or not a design-system widget. <b>Unsure</b> goes to a third person.
  Judge what you see: no automated opinion of any kind is shown on this page. Your answers are kept in this browser while you work.</p>
${cards}
</main>
<script>
(function(){
  var who=document.getElementById('who'), prog=document.getElementById('progress'), cards=[].slice.call(document.querySelectorAll('.card'));
  var KEY='uta-review-${esc(records.map((r) => r.id).join('').length)}';
  function load(){try{return JSON.parse(localStorage.getItem(KEY)||'{}')}catch(e){return {}}}
  function store(s){try{localStorage.setItem(KEY,JSON.stringify(s))}catch(e){}}
  var state=load(); who.value=state._who||'';
  cards.forEach(function(c){var id=c.dataset.id,s=state[id]||{};
    if(s.label){var r=c.querySelector('input[value="'+s.label+'"]'); if(r) r.checked=true;}
    c.querySelector('textarea').value=s.notes||'';});
  function read(c){var r=c.querySelector('input:checked');return {label:r?r.value:'',notes:c.querySelector('textarea').value};}
  function refresh(){var n=0,s={_who:who.value};cards.forEach(function(c){var v=read(c);s[c.dataset.id]=v;if(v.label){n++;c.classList.add('done')}else c.classList.remove('done')});store(s);prog.textContent=n+' / '+cards.length+' labelled';}
  document.addEventListener('input',refresh);document.addEventListener('change',refresh);refresh();
  function q(v){v=String(v==null?'':v);return /[",\\n\\r]/.test(v)?'"'+v.replace(/"/g,'""')+'"':v}
  document.getElementById('save').addEventListener('click',function(){
    var name=(who.value||'').trim(); if(!name){alert('Please type your name first.');return}
    var lines=['id,label,notes,labeller'];cards.forEach(function(c){var v=read(c);lines.push([c.dataset.id,v.label,v.notes,name].map(q).join(','))});
    var a=document.createElement('a');a.href=URL.createObjectURL(new Blob([lines.join('\\n')+'\\n'],{type:'text/csv'}));a.download='labels-'+name.replace(/[^a-z0-9_-]/gi,'_')+'.csv';document.body.appendChild(a);a.click();a.remove();
  });
})();
</script></body></html>`;
}
