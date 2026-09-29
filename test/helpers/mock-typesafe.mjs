// Stand-in for the TypeSafe API used only to test plumbing. Its "intelligence" is a keyword rule, so numbers it produces mean nothing.
import http from 'node:http';
const RISKY = /(delete|remove|transfer|pay|close account|sign out|reset|revoke|approve|disburse|cancel sub|withdraw|block|reverse|устгах|төлөх|шилжүүлэг|хаах|гарах|олгох|цуцлах|татах|буцаах|хасах|батлах|блоклох)/i;
export function startMock() {
  return new Promise((resolve) => {
    let calls = 0;
    const srv = http.createServer((req, res) => {
      let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => {
        calls++;
        const body = JSON.parse(b); const answers = {};
        for (const [id, q] of Object.entries(body.questions)) {
          const text = JSON.stringify(body.state);
          if (id === 'risky') { const r = RISKY.test(body.state.control_label); answers[id] = { type: 'noul', noul: r ? 0.9 : 0.08, confidence: r ? 0.85 : 0.9 }; }
          else if (id === 'real_defect') { const notReal = /"(srOnly|ariaHidden|disabled)":true/.test(text) || /logo|Material Icons|Font Awesome/.test(text); answers[id] = { type: 'noul', noul: notReal ? 0.1 : 0.92, confidence: 0.88 }; }
          else answers[id] = { type: 'choice', choice: Object.keys(q.criteria)[0], confidence: 0.9 };
        }
        res.setHeader('content-type', 'application/json');
        res.end(JSON.stringify({ model: 'mock', answers, usage: { input_tokens: 150, output_tokens: 8 } }));
      });
    }).listen(0, () => resolve({ base: `http://127.0.0.1:${srv.address().port}`, calls: () => calls, close: () => { srv.closeAllConnections(); srv.close(); } }));
  });
}
