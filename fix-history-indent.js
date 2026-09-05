const fs = require('fs');
const p = 'c:/Users/jps16/OneDrive/Desktop/E-Farm-4/frontend/src/dashboards/DeliveryDashboard.jsx';
let s = fs.readFileSync(p, 'utf8');

const hasCRLF = s.includes('\r\n');
const nl = hasCRLF ? '\r\n' : '\n';

const cssStart = [
  '    @media (max-width: 460px) {',
  '      .dlv-stats { grid-template-columns: 1fr; }',
  '      .dlv-topbar { flex-wrap: wrap; }',
  '      .dlv-dcard-meta { grid-template-columns: 1fr 1fr; }',
  '    }',
  '',
].join(nl);

const addCss = `
    /* ---------------- DEDICATED SECTION VIEWS ---------------- */

    .dlv-main.dlv-view-available .dlv-stats,
    .dlv-main.dlv-view-my .dlv-stats,
    .dlv-main.dlv-view-history .dlv-stats,
    .dlv-main.dlv-view-earnings .dlv-stats,
    .dlv-main.dlv-view-notifications .dlv-stats,
    .dlv-main.dlv-view-settings .dlv-stats {
      display: none;
    }

    .dlv-main.dlv-view-available .dlv-grid,
    .dlv-main.dlv-view-my .dlv-grid,
    .dlv-main.dlv-view-history .dlv-grid,
    .dlv-main.dlv-view-earnings .dlv-grid,
    .dlv-main.dlv-view-notifications .dlv-grid,
    .dlv-main.dlv-view-settings .dlv-grid {
      grid-template-columns: minmax(0, 1fr);
    }

    .dlv-main.dlv-view-available .dlv-col-side,
    .dlv-main.dlv-view-my .dlv-col-side,
    .dlv-main.dlv-view-history .dlv-col-side,
    .dlv-main.dlv-view-settings .dlv-col-side {
      display: none;
    }

    .dlv-main.dlv-view-available .dlv-col > section:not(#dlv-sec-available),
    .dlv-main.dlv-view-my .dlv-col > section:not(#dlv-sec-my),
    .dlv-main.dlv-view-history .dlv-col > section:not(#dlv-sec-history),
    .dlv-main.dlv-view-settings .dlv-col > section:not(#dlv-sec-settings) {
      display: none;
    }

    .dlv-main.dlv-view-earnings .dlv-col,
    .dlv-main.dlv-view-notifications .dlv-col {
      display: none;
    }

    .dlv-main.dlv-view-earnings .dlv-col-side > section:not(#dlv-sec-earnings),
    .dlv-main.dlv-view-notifications .dlv-col-side > section:not(#dlv-sec-notifications) {
      display: none;
    }

    .dlv-main.dlv-view-earnings .dlv-col-side,
    .dlv-main.dlv-view-notifications .dlv-col-side {
      position: static;
    }

    .dlv-main.dlv-view-available .dlv-col,
    .dlv-main.dlv-view-my .dlv-col,
    .dlv-main.dlv-view-history .dlv-col,
    .dlv-main.dlv-view-earnings .dlv-col-side,
    .dlv-main.dlv-view-notifications .dlv-col-side,
    .dlv-main.dlv-view-settings .dlv-col {
      width: 100%;
    }
`;

const addCssCrlf = addCss.replace(/\n/g, nl);

if (!s.includes(cssStart)) {
  console.log('cssStart NOT found');
  console.log('context:', JSON.stringify(s.slice(s.indexOf('@media (max-width: 460px)') - 40, s.indexOf('@media (max-width: 460px)') + 200)));
  process.exit(1);
}

s = s.replace(cssStart, cssStart + addCssCrlf);
fs.writeFileSync(p, s);
console.log('DEDICATED VIEW CSS ADDED');