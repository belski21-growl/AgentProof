/* AgentProof web app: vanilla JS, zero dependencies.
 * Reads via public JSON-RPC; writes only through the user's own injected
 * wallet (window.ethereum). No WalletConnect, no QR login, no tracking.
 * Fill in CONFIG after deployment (mainnet live).
 */
'use strict';

/* ------------------------------------------------------------------ */
/* CONFIG: edit after each deployment                                 */
/* ------------------------------------------------------------------ */
const CONFIG = {
  chainId: 56, // 97 = BSC testnet; 56 = BSC mainnet
  chainName: 'BSC Mainnet',
  rpcUrl: 'https://bsc.publicnode.com',
  explorer: 'https://bscscan.com',
  // AgentProof registry contract (empty until deployed):
  contractAddress: '0x8Ae420973b52D31A3Aef129f0F773F37aF9a215C',
  // Agent ID token contract (SPACE ID, mainnet):
  agentIdContract: '0x60b9262456de011f7d15a54cdd8c48baaa8b022f',
  // First block to scan for Attested events (set to the deploy block):
  deployBlock: 134493804,
  logChunkSize: 1000,
};

/* ------------------------------------------------------------------ */
/* ABI constants (verified against `cast sig` / `cast keccak`)         */
/* ------------------------------------------------------------------ */
const SEL_ATTEST = '0x6dae6eed'; // attest(address,uint8,bytes32)
const SEL_BALANCE_OF = '0x70a08231'; // balanceOf(address)
const SEL_ATTESTATION_COUNT = '0x44bb1cbf'; // attestationCount(address)
const SEL_GET_ATTESTATION = '0xe8d55ccf'; // getAttestation(address,address)
const TOPIC_ATTESTED =
  '0x2287a2652c6b5340c09bd91963caacbebfa3f7d8e722b19b7ee27f7a0be77eb4';
// Attested(address indexed agent, address indexed nftContract,
//         uint8 verdict, bytes32 evidenceHash, uint64 timestamp)

const VERDICTS = ['SAFE', 'HOLD', 'BLOCK'];
const VERDICT_LABEL = ['Safe to mint', 'Hold: needs more checks', 'Block: template or scam'];

/* ------------------------------------------------------------------ */
/* Attest queue: contracts already security-verified by hand (seed     */
/* attestations, 19 Nov 2026). Evidence hashes are the keccak256 of   */
/* the evidence notes stored with the seed attestations, so a queue    */
/* attestation references the same verified evidence.                 */
/* ------------------------------------------------------------------ */
const ATTEST_TARGET = 30; // distinct Agent ID attesters needed by 9 Dec 2026
const QUEUE = [
  {
    name: 'ContextGraph Nodes',
    contract: '0x08b1323a74530BEDd2188b458eBcC856315d8E0f',
    verdict: 0,
    blurb: 'Free mint, site live, 3 nodes minted #777 #1113 #2934.',
    note: 'AgentProof seed: ContextGraph Nodes verified SAFE by belski 2026-11-19 - free mint, site contextgraph.art live, owner not on skip-list, 3 nodes minted #777 #1113 #2934',
    evidenceHash: '0x04e481eb7a63985c80226b8b028a6be5479045186e5aa2af20cf9bd73b092c49',
  },
  {
    name: 'Baiwor Passport',
    contract: '0x0c458d61848ef7ffd753fbdd1179a7053a60661f',
    verdict: 0,
    blurb: 'Free mint, site live, Sourcify verified, #40 minted.',
    note: 'AgentProof seed: Baiwor Passport verified SAFE by belski 2026-11-19 - free mint, site baiwor.my.id live, Sourcify verified, #40 minted',
    evidenceHash: '0x4b4908ddd5670a317f18b7b6cdb4948a41cdda0d61718043a66173ab54679b1f',
  },
  {
    name: 'Talvio Dot Robot',
    contract: '0xFfC521D504F20bd7bCd0871B9B39BA9501F5dB2C',
    verdict: 0,
    blurb: 'Free mint, site live, #119 minted.',
    note: 'AgentProof seed: Talvio Dot Robot verified SAFE by belski 2026-11-19 - free mint, site talviogenerate.com live, #119 minted',
    evidenceHash: '0x081daf490101509a5f2a26b576174ccef8a032c4e3c478ec55ee7d2bdb114542',
  },
  {
    name: 'AONE Hero',
    contract: '0x9B0c237A123277fCf8768550Bbdd7767C73Cf5D3',
    verdict: 0,
    blurb: 'Free mint, 2 heroes #1504 #1505 minted, 3000 AONE locked each.',
    note: 'AgentProof seed: AONE Hero verified SAFE by belski 2026-11-19 - free mint, 2 heroes #1504 #1505 minted, 3000 AONE locked each',
    evidenceHash: '0x1fcc2dd0061fd8504521fda743036d81e4c1b58a5c8a77fce20ae4e42d2fd479',
  },
];

/* ------------------------------------------------------------------ */
/* Encoding / decoding helpers (pure functions)                        */
/* ------------------------------------------------------------------ */
function isAddress(v) {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{40}$/.test(v);
}
function isBytes32(v) {
  return typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v);
}
function strip0x(h) {
  return h.startsWith('0x') ? h.slice(2) : h;
}
function pad32(hexNoPrefix) {
  return hexNoPrefix.padStart(64, '0');
}
function encodeAddress(addr) {
  return pad32(strip0x(addr).toLowerCase());
}
function encodeUint(n) {
  return pad32(Number(n).toString(16));
}
function encodeBytes32(h) {
  return pad32(strip0x(h).toLowerCase());
}
function buildAttestCalldata(nftContract, verdict, evidenceHash) {
  if (!isAddress(nftContract)) throw new Error('invalid contract address');
  const v = Number(verdict);
  if (![0, 1, 2].includes(v)) throw new Error('verdict must be 0, 1 or 2');
  if (!isBytes32(evidenceHash)) throw new Error('evidenceHash must be 0x + 64 hex chars');
  return SEL_ATTEST + encodeAddress(nftContract) + encodeUint(v) + encodeBytes32(evidenceHash);
}
function buildBalanceOfCalldata(addr) {
  return SEL_BALANCE_OF + encodeAddress(addr);
}
function buildAttestationCountCalldata(contract) {
  return SEL_ATTESTATION_COUNT + encodeAddress(contract);
}
function buildGetAttestationCalldata(contract, agent) {
  return SEL_GET_ATTESTATION + encodeAddress(contract) + encodeAddress(agent);
}
function decodeUint256(hex) {
  return BigInt('0x' + strip0x(hex).slice(-64));
}
function decodeAttestation(hex) {
  const d = strip0x(hex);
  if (d.length < 256) throw new Error('getAttestation return too short');
  return {
    verdict: Number(BigInt('0x' + d.slice(0, 64))),
    evidenceHash: '0x' + d.slice(64, 128),
    timestamp: Number(BigInt('0x' + d.slice(128, 192))),
    exists: BigInt('0x' + d.slice(192, 256)) !== 0n,
  };
}
// Parse one raw eth_getLogs entry for the Attested event.
function parseAttestedLog(log) {
  if (!log.topics || log.topics[0].toLowerCase() !== TOPIC_ATTESTED) return null;
  const agent = '0x' + log.topics[1].slice(-40);
  const nftContract = '0x' + log.topics[2].slice(-40);
  const d = strip0x(log.data);
  return {
    agent: agent.toLowerCase(),
    nftContract: nftContract.toLowerCase(),
    verdict: Number(BigInt('0x' + d.slice(0, 64))),
    evidenceHash: '0x' + d.slice(64, 128),
    timestamp: Number(BigInt('0x' + d.slice(128, 192))),
    blockNumber: parseInt(log.blockNumber, 16),
    transactionHash: log.transactionHash,
  };
}
// Aggregate parsed logs: latest verdict per (contract, agent) wins.
function aggregateAttestations(logs) {
  const byContract = new Map(); // contract -> { agents: Map(agent -> att), count }
  for (const a of logs) {
    if (!a) continue;
    let c = byContract.get(a.nftContract);
    if (!c) {
      c = { agents: new Map(), lastTimestamp: 0 };
      byContract.set(a.nftContract, c);
    }
    const prev = c.agents.get(a.agent);
    if (!prev || a.timestamp >= prev.timestamp) c.agents.set(a.agent, a);
    if (a.timestamp > c.lastTimestamp) c.lastTimestamp = a.timestamp;
  }
  const rows = [];
  for (const [contract, c] of byContract) {
    const verdicts = { 0: 0, 1: 0, 2: 0 };
    for (const a of c.agents.values()) verdicts[a.verdict]++;
    rows.push({
      contract,
      attestorCount: c.agents.size,
      verdicts,
      lastTimestamp: c.lastTimestamp,
      agents: [...c.agents.values()],
    });
  }
  rows.sort((x, y) => y.attestorCount - x.attestorCount || y.lastTimestamp - x.lastTimestamp);
  return rows;
}

/* ------------------------------------------------------------------ */
/* RPC helpers                                                         */
/* ------------------------------------------------------------------ */
async function rpc(method, params) {
  const res = await fetch(CONFIG.rpcUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', method, params, id: 1 }),
  });
  if (!res.ok) throw new Error('RPC HTTP ' + res.status);
  const json = await res.json();
  if (json.error) throw new Error('RPC error: ' + JSON.stringify(json.error));
  return json.result;
}
async function ethCall(to, data) {
  return rpc('eth_call', [{ to, data }, 'latest']);
}
async function getAgentIdBalance(address) {
  if (!CONFIG.agentIdContract) throw new Error('Agent ID contract not configured yet');
  const raw = await ethCall(CONFIG.agentIdContract, buildBalanceOfCalldata(address));
  return decodeUint256(raw);
}
async function getAttestationCount(contract) {
  if (!CONFIG.contractAddress) throw new Error('AgentProof contract not configured yet');
  const raw = await ethCall(CONFIG.contractAddress, buildAttestationCountCalldata(contract));
  return decodeUint256(raw);
}
async function getAttestation(contract, agent) {
  if (!CONFIG.contractAddress) throw new Error('AgentProof contract not configured yet');
  const raw = await ethCall(
    CONFIG.contractAddress,
    buildGetAttestationCalldata(contract, agent)
  );
  return decodeAttestation(raw);
}
async function fetchAttestedLogs(fromBlock, toBlock) {
  if (!CONFIG.contractAddress) return [];
  const logs = await rpc('eth_getLogs', [
    {
      fromBlock: '0x' + fromBlock.toString(16),
      toBlock: '0x' + toBlock.toString(16),
      address: CONFIG.contractAddress,
      topics: [TOPIC_ATTESTED],
    },
  ]);
  return logs;
}
async function loadAllAttestations() {
  if (!CONFIG.contractAddress) return [];
  const latest = parseInt(await rpc('eth_blockNumber', []), 16);
  const from = CONFIG.deployBlock || 0;
  const all = [];
  for (let start = from; start <= latest; start += CONFIG.logChunkSize) {
    const end = Math.min(start + CONFIG.logChunkSize - 1, latest);
    const chunk = await fetchAttestedLogs(start, end);
    for (const log of chunk) {
      const parsed = parseAttestedLog(log);
      if (parsed) all.push(parsed);
    }
  }
  return aggregateAttestations(all);
}

/* ------------------------------------------------------------------ */
/* Evidence hash: SHA-256 of pasted text (browser-native, no deps)     */
/* ------------------------------------------------------------------ */
async function sha256Hex(text) {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return '0x' + [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/* ------------------------------------------------------------------ */
/* Browser UI (runs only when loaded in a page)                        */
/* ------------------------------------------------------------------ */
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', () => initPage());
}

let connectedAccount = null;

async function initPage() {
  setText('contract-address', CONFIG.contractAddress || 'not deployed yet');
  setText('chain-name', CONFIG.chainName);
  setText('agentid-contract', CONFIG.agentIdContract || 'not configured yet');
  setHref('contract-explorer-link', CONFIG.contractAddress
    ? CONFIG.explorer + '/address/' + CONFIG.contractAddress
    : '#');
  if (!CONFIG.contractAddress) {
    setText('deploy-note', 'The registry contract is not deployed yet. The list below will populate after the mainnet deployment.');
    show('deploy-banner');
  }
  bind('btn-refresh', () => refreshList());
  bind('btn-connect', () => connectWallet());
  bind('btn-attest', () => submitAttest());
  bind('btn-evidence-hash', () => computeEvidenceHash());
  const searchForm = $('search-form');
  if (searchForm) {
    searchForm.addEventListener('submit', (e) => {
      e.preventDefault();
      searchContract();
    });
  }
  await refreshList();
}

function $(id) {
  return document.getElementById(id);
}
function setText(id, v) {
  const el = $(id);
  if (el) el.textContent = v;
}
function setHref(id, v) {
  const el = $(id);
  if (el) el.href = v;
}
function show(id) {
  const el = $(id);
  if (el) el.style.display = '';
}
function hide(id) {
  const el = $(id);
  if (el) el.style.display = 'none';
}
function bind(id, fn) {
  const el = $(id);
  if (el) el.addEventListener('click', fn);
}
function setStatus(msg, isError) {
  const el = $('status');
  if (!el) return;
  el.textContent = msg;
  el.style.color = isError ? '#ff6b6b' : '';
}

async function refreshList() {
  const tbody = $('attest-table-body');
  if (!tbody) return;
  tbody.innerHTML = '<tr><td colspan="5">Loading…</td></tr>';
  try {
    const rows = await loadAllAttestations();
    lastRows = rows;
    setText('stat-contracts', String(rows.length));
    setText('stat-attestations', String(rows.reduce((n, r) => n + r.attestorCount, 0)));
    renderMixBar(rows);
    renderQueue(rows);
    renderLeaderboard(rows);
    updateAttesterStats(rows);
    if (!rows.length) {
      tbody.innerHTML = '<tr><td colspan="5">No attestations yet. Be the first to attest a contract below.</td></tr>';
      return;
    }
    tbody.innerHTML = rows.map((r) => {
      const v = r.verdicts[2] > 0 ? 2 : r.verdicts[1] > 0 ? 1 : 0;
      return '<tr>' +
        '<td data-label="Contract"><a href="' + CONFIG.explorer + '/address/' + r.contract + '" target="_blank" rel="noopener">' + shortAddr(r.contract) + '</a></td>' +
        '<td data-label="Verdict"><span class="verdict v' + v + '">' + VERDICTS[v] + '</span></td>' +
        '<td data-label="Attestors">' + r.attestorCount + '</td>' +
        '<td data-label="Breakdown">' + r.verdicts[0] + ' safe / ' + r.verdicts[1] + ' hold / ' + r.verdicts[2] + ' block</td>' +
        '<td data-label="Last attested">' + new Date(r.lastTimestamp * 1000).toLocaleString() + '</td>' +
        '</tr>';
    }).join('');
  } catch (e) {
    tbody.innerHTML = '<tr><td colspan="5">Failed to load: ' + escapeHtml(e.message) + '</td></tr>';
  }
}

// Latest loaded registry rows (drives the check result panel + mix bar).
let lastRows = [];

// Live verdict distribution across all attestations (the registry's mix).
function renderMixBar(rows) {
  const wrap = $('verdict-mix');
  const bar = $('mix-bar');
  const legend = $('mix-legend');
  if (!wrap || !bar || !legend) return;
  const totals = { 0: 0, 1: 0, 2: 0 };
  for (const r of rows) {
    totals[0] += r.verdicts[0];
    totals[1] += r.verdicts[1];
    totals[2] += r.verdicts[2];
  }
  const total = totals[0] + totals[1] + totals[2];
  if (!total) {
    wrap.style.display = 'none';
    return;
  }
  wrap.style.display = '';
  const pct = (n) => ((n / total) * 100).toFixed(1) + '%';
  bar.innerHTML =
    '<i class="m-safe" style="width:' + pct(totals[0]) + '"></i>' +
    '<i class="m-hold" style="width:' + pct(totals[1]) + '"></i>' +
    '<i class="m-block" style="width:' + pct(totals[2]) + '"></i>';
  legend.innerHTML = 'Verdict mix across all attestations: <b>' + totals[0] +
    ' safe</b> &middot; <b>' + totals[1] + ' hold</b> &middot; <b>' + totals[2] +
    ' block</b> (of ' + total + ' total).';
}

// Attest queue: pre-verified contracts, one click prefills the form.
function renderQueue(rows) {
  const grid = $('queue-grid');
  if (!grid) return;
  const countByContract = new Map();
  for (const r of rows) countByContract.set(r.contract, r.attestorCount);
  grid.innerHTML = QUEUE.map((q, i) => {
    const n = countByContract.get(q.contract.toLowerCase()) || 0;
    return '<article class="queue-card">' +
      '<h3>' + escapeHtml(q.name) + ' <span class="verdict v' + q.verdict + '">' + VERDICTS[q.verdict] + '</span></h3>' +
      '<p><a class="mono" href="' + CONFIG.explorer + '/address/' + q.contract + '" target="_blank" rel="noopener">' + shortAddr(q.contract) + '</a></p>' +
      '<p>' + escapeHtml(q.blurb) + '</p>' +
      '<p class="queue-meta">' + n + ' attestation' + (n === 1 ? '' : 's') + ' so far</p>' +
      '<div class="row"><button class="btn-small" data-queue="' + i + '">Attest SAFE</button></div>' +
      '</article>';
  }).join('');
  grid.querySelectorAll('[data-queue]').forEach((btn) => {
    btn.addEventListener('click', () => prefillAttest(QUEUE[Number(btn.dataset.queue)]));
  });
}

// Attester leaderboard: distinct Agent ID holders, ranked by attestations.
function renderLeaderboard(rows) {
  const list = $('leaders-list');
  if (!list) return;
  const byAgent = new Map();
  for (const r of rows) {
    for (const a of r.agents) byAgent.set(a.agent, (byAgent.get(a.agent) || 0) + 1);
  }
  const leaders = [...byAgent.entries()].sort((x, y) => y[1] - x[1]);
  if (!leaders.length) {
    list.innerHTML = '<li class="muted">No attestations yet. Be the first name on this board.</li>';
    return;
  }
  list.innerHTML = leaders.map(([agent, n], i) =>
    '<li><span class="leaders-rank">' + (i + 1) + '.</span>' +
    '<a class="mono" href="' + CONFIG.explorer + '/address/' + agent + '" target="_blank" rel="noopener">' + shortAddr(agent) + '</a>' +
    '<span class="leaders-count">' + n + ' attestation' + (n === 1 ? '' : 's') + '</span></li>'
  ).join('');
}

// Distinct attesters vs the 30 needed before 9 Dec 2026.
function updateAttesterStats(rows) {
  const agents = new Set();
  for (const r of rows) {
    for (const a of r.agents) agents.add(a.agent);
  }
  const n = agents.size;
  setText('stat-attesters', String(n));
  setText('stat-attesters-left', String(Math.max(0, ATTEST_TARGET - n)));
}

// Fill the attest form from a queue card and jump to it.
function prefillAttest(q) {
  const contractEl = $('attest-contract');
  const verdictEl = $('attest-verdict');
  const textEl = $('evidence-text');
  const hashEl = $('evidence-hash');
  if (contractEl) contractEl.value = q.contract;
  if (verdictEl) verdictEl.value = String(q.verdict);
  if (textEl) textEl.value = q.note;
  if (hashEl) hashEl.value = q.evidenceHash;
  const target = $('attest');
  if (target) target.scrollIntoView({ behavior: 'smooth' });
  if (!connectedAccount) {
    setStatus('Form prefilled for ' + q.name + '. Connect your wallet to send this attestation.');
  } else {
    setStatus('Form prefilled for ' + q.name + '. Review and confirm in your wallet.');
  }
}

// Show the check result as a verdict panel (the page's dealt moment).
function showResult(cls, html) {
  const out = $('search-result');
  if (!out) return;
  out.className = 'result show' + (cls ? ' ' + cls : '');
  out.innerHTML = html;
}

function shortAddr(a) {
  return a.slice(0, 6) + '…' + a.slice(-4);
}
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

async function searchContract() {
  const input = $('search-input');
  const btn = $('btn-search');
  if (!input) return;
  const addr = input.value.trim();
  if (!isAddress(addr)) {
    showResult('error', '<p>Enter a valid 0x contract address.</p>');
    return;
  }
  if (btn) {
    btn.disabled = true;
    btn.textContent = 'Checking…';
  }
  showResult('loading', '<p>Checking…</p>');
  try {
    const count = await getAttestationCount(addr);
    const row = lastRows.find((r) => r.contract === addr.toLowerCase());
    const explorerUrl = CONFIG.explorer + '/address/' + addr;
    if (count === 0n) {
      showResult('none',
        '<span class="result-verdict">Not attested yet</span>' +
        '<p>No agent has verified <span class="mono">' + escapeHtml(addr) + '</span> on-chain.</p>' +
        '<p><a href="' + explorerUrl + '" target="_blank" rel="noopener">View on explorer</a></p>');
    } else if (row) {
      const worst = row.verdicts[2] > 0 ? 2 : row.verdicts[1] > 0 ? 1 : 0;
      showResult('v' + worst,
        '<span class="result-verdict">' + VERDICTS[worst] + '</span>' +
        '<p><b>' + count.toString() + '</b> attestation' + (count === 1n ? '' : 's') +
        ' for <span class="mono">' + escapeHtml(addr) + '</span>: ' +
        row.verdicts[0] + ' safe, ' + row.verdicts[1] + ' hold, ' + row.verdicts[2] + ' block.</p>' +
        '<p>' + VERDICT_LABEL[worst] + '. <a href="' + explorerUrl + '" target="_blank" rel="noopener">View on explorer</a></p>');
    } else {
      showResult('none',
        '<span class="result-verdict">' + count.toString() + ' attestations</span>' +
        '<p>Attestations exist for <span class="mono">' + escapeHtml(addr) + '</span> on-chain.</p>' +
        '<p><a href="' + explorerUrl + '" target="_blank" rel="noopener">View on explorer for the full history</a></p>');
    }
  } catch (e) {
    showResult('error', '<p>Lookup failed: ' + escapeHtml(e.message) + '</p>');
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Check a contract';
    }
  }
}

async function connectWallet() {
  if (!window.ethereum) {
    setStatus('An injected wallet was not found. Install a wallet browser extension and reload. Connection here is injected-wallet only.', true);
    return;
  }
  try {
    const accounts = await window.ethereum.request({ method: 'eth_requestAccounts' });
    connectedAccount = accounts[0];
    setText('wallet-address', connectedAccount);
    show('wallet-info');
    const chainHex = await window.ethereum.request({ method: 'eth_chainId' });
    const chainId = parseInt(chainHex, 16);
    if (chainId !== CONFIG.chainId) {
      setStatus('Your wallet is on chain ' + chainId + '. Please switch to ' + CONFIG.chainName + ' (chain ' + CONFIG.chainId + ').', true);
      return;
    }
    const bal = await getAgentIdBalance(connectedAccount);
    setText('agentid-balance', bal.toString());
    if (bal === 0n) {
      setStatus('Attesting requires holding at least one Agent ID.', true);
    } else {
      setStatus('Connected. Agent ID balance: ' + bal.toString() + '. You can attest.');
      show('attest-form');
    }
  } catch (e) {
    setStatus('Wallet connection failed: ' + e.message, true);
  }
}

async function computeEvidenceHash() {
  const input = $('evidence-text');
  const out = $('evidence-hash');
  if (!input || !out) return;
  const text = input.value.trim();
  if (!text) {
    out.value = '';
    return;
  }
  if (isBytes32(text)) {
    out.value = text.toLowerCase();
    return;
  }
  out.value = await sha256Hex(text);
}

async function submitAttest() {
  if (!connectedAccount) {
    setStatus('Connect your wallet first (injected wallet only).', true);
    return;
  }
  if (!CONFIG.contractAddress) {
    setStatus('The registry contract is not deployed yet.', true);
    return;
  }
  const contract = $('attest-contract').value.trim();
  const verdict = $('attest-verdict').value;
  const evidenceHash = $('evidence-hash').value.trim().toLowerCase();
  try {
    const data = buildAttestCalldata(contract, verdict, evidenceHash);
    setStatus('Sending transaction. Please review and confirm it in your wallet. Nothing is signed without your confirmation.');
    const txHash = await window.ethereum.request({
      method: 'eth_sendTransaction',
      params: [{ from: connectedAccount, to: CONFIG.contractAddress, data }],
    });
    setStatus('Attestation sent: ' + txHash);
    setHref('tx-link', CONFIG.explorer + '/tx/' + txHash);
    show('tx-link-row');
    await refreshList();
  } catch (e) {
    setStatus('Attest failed: ' + (e && e.message ? e.message : e), true);
  }
}

// Export for Node-based verification (ignored in the browser).
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    CONFIG, buildAttestCalldata, parseAttestedLog, aggregateAttestations,
    decodeUint256, decodeAttestation, isAddress, isBytes32, sha256Hex,
    getAgentIdBalance, getAttestationCount, getAttestation, loadAllAttestations,
  };
}
