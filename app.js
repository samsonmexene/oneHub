
// app.js — Modern offline app (no frameworks)
// Data storage uses localStorage for persistence in offline mode
const STORAGE_KEY = 'offline_ops_v2';

// --- State & Sample Data ---
let state = {
  users: [
    { id: 'u1', username: 'site.alex', password: 'password', role: 'site', name: 'Alex (Site)' },
    { id: 'u2', username: 'office.mia', password: 'password', role: 'office', name: 'Mia (Office)' }
  ],
  currentUser: null,
  inventory: [
    { id: 'i1', name: 'Cement 40kg', sku: 'CEM-40', onhand: 60, min: 20, max: 200 },
    { id: 'i2', name: 'Rebar #4', sku: 'REB-4', onhand: 350, min: 100, max: 1000 }
  ],
  purchaseRequests: [], // each { id, requester, status, lines: [{item, sku, qty, unitCost}] , ts }
  deliveries: [],
  audit: []
};

// load from localStorage
(function load(){ try{ const raw = localStorage.getItem(STORAGE_KEY); if(raw) state = JSON.parse(raw); }catch(e){ console.warn('Failed to load storage', e); } })();

function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }

// --- Utility ---
const $ = sel => document.querySelector(sel);
const $$ = sel => Array.from(document.querySelectorAll(sel));
const uid = (p='id') => p + '_' + Date.now() + '_' + Math.floor(Math.random()*1e6);
const now = () => new Date().toLocaleString();

// --- Modal handling ---
document.addEventListener('click', e => {
  const open = e.target.closest('[data-open]');
  if(open){ const id = open.dataset.open; openModal(id); return; }
  const close = e.target.closest('[data-close]');
  if(close){ const modal = close.closest('.modal'); closeModal(modal.id); return; }
});

function openModal(id){
  const m = document.getElementById(id); if(!m) return;
  m.setAttribute('aria-hidden','false');
  renderAll(); // ensure content is up to date whenever modal opens
}
function closeModal(id){
  const m = document.getElementById(id); if(!m) return;
  m.setAttribute('aria-hidden','true');
}

// close modals when clicking outside panel
document.querySelectorAll('.modal').forEach(modal => {
  modal.addEventListener('click', e => {
    if(e.target === modal) modal.setAttribute('aria-hidden','true');
  });
});

// --- Auth ---
const loginForm = document.getElementById('loginForm');
loginForm.addEventListener('submit', e => {
  e.preventDefault();
  const u = document.getElementById('loginUser').value.trim();
  const p = document.getElementById('loginPass').value;
  const user = state.users.find(x=>x.username === u && x.password === p);
  if(user){ state.currentUser = { id: user.id, username: user.username, role: user.role, name: user.name }; audit('login', user.username); save(); closeModal('modal-auth'); alert('Signed in as ' + user.name); renderAll(); }
  else alert('Invalid credentials');
});

// --- Audit ---
function audit(action, by, details){ state.audit.unshift({ id: uid('a'), ts: now(), action, by: by||'system', details: details||{} }); save(); renderAudit(); renderRecentActivity(); }
function renderRecentActivity(){
  const ul = document.getElementById('recent-activity'); if(!ul) return;
  ul.innerHTML = '';
  state.audit.slice(0,10).forEach(a=>{ const li = document.createElement('li'); li.textContent = `${a.ts} — ${a.by}: ${a.action}`; ul.appendChild(li); });
}

// --- Inventory ---
function renderInventory(){
  const tbody = document.querySelector('#inventoryTable tbody'); if(!tbody) return;
  tbody.innerHTML = '';
  state.inventory.forEach(item=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `<td>${item.name}</td><td>${item.sku}</td><td>${item.onhand}</td><td>${item.min}</td><td>${item.max}</td>
    <td><button class="btn" data-edit="${item.id}">Edit</button> <button class="btn danger" data-remove="${item.id}">Remove</button></td>`;
    tbody.appendChild(tr);
  });
}

// add/edit inventory modal
document.getElementById('addInventoryBtn').addEventListener('click', ()=>{
  openModal('modal-edit-item');
  document.getElementById('editTitle').textContent = 'Add Item';
  document.getElementById('editItemForm').dataset.editId = '';
  document.getElementById('editName').value=''; document.getElementById('editSku').value=''; document.getElementById('editOnhand').value=0;
  document.getElementById('editMin').value=0; document.getElementById('editMax').value=0;
});

document.getElementById('inventoryTable').addEventListener('click', e=>{
  const edit = e.target.closest('[data-edit]'); if(edit){ const id = edit.dataset.edit; const it = state.inventory.find(x=>x.id===id); if(it){ openModal('modal-edit-item'); document.getElementById('editTitle').textContent='Edit Item'; document.getElementById('editItemForm').dataset.editId = it.id; document.getElementById('editName').value=it.name; document.getElementById('editSku').value=it.sku; document.getElementById('editOnhand').value=it.onhand; document.getElementById('editMin').value=it.min; document.getElementById('editMax').value=it.max; } }
  const rem = e.target.closest('[data-remove]'); if(rem){ const id = rem.dataset.remove; state.inventory = state.inventory.filter(x=>x.id!==id); audit('remove inventory', state.currentUser?state.currentUser.username:'system', {id}); save(); renderInventory(); renderAll(); }
});

document.getElementById('editItemForm').addEventListener('submit', e=>{
  e.preventDefault();
  const id = e.target.dataset.editId;
  const name = document.getElementById('editName').value.trim();
  const sku = document.getElementById('editSku').value.trim();
  const onhand = Number(document.getElementById('editOnhand').value)||0;
  const min = Number(document.getElementById('editMin').value)||0;
  const max = Number(document.getElementById('editMax').value)||0;
  if(id){ // update
    const it = state.inventory.find(x=>x.id===id);
    Object.assign(it,{name,sku,onhand,min,max});
    audit('update inventory', state.currentUser?state.currentUser.username:'system',{id,name,sku});
  } else {
    const newItem = { id: uid('i'), name, sku, onhand, min, max };
    state.inventory.push(newItem); audit('add inventory', state.currentUser?state.currentUser.username:'system',{id:newItem.id,name,sku});
  }
  save(); renderInventory(); closeModal('modal-edit-item'); renderAll();
});

// --- Purchase Requests: dynamic lines ---
const prLinesContainer = document.getElementById('prLines');
const addPrLineBtn = document.getElementById('addPrLine');
addPrLineBtn.addEventListener('click', addPrLine);

// create one initial line
function createPrLine(item='', sku='', qty=1, cost=''){
  const id = uid('pl');
  const div = document.createElement('div');
  div.className = 'pr-line';
  div.dataset.lineId = id;
  div.innerHTML = `
    <input class="pl-item" placeholder="Item name" value="${item}" />
    <input class="pl-qty" type="number" min="1" value="${qty}" />
    <input class="pl-cost" placeholder="Unit cost" value="${cost}" />
    <div>
      <button class="btn" data-remove-line>Remove</button>
    </div>
  `;
  // remove handler
  div.querySelector('[data-remove-line]').addEventListener('click', ()=>{ div.remove(); });
  return div;
}

function addPrLine(){ prLinesContainer.appendChild(createPrLine()); }
// initial line
addPrLine();

// compile PR from all lines
document.getElementById('compilePr').addEventListener('click', ()=>{
  if(!state.currentUser){ alert('Please sign in first'); openModal('modal-auth'); return; }
  const lines = Array.from(prLinesContainer.querySelectorAll('.pr-line')).map(div=>{
    const item = div.querySelector('.pl-item').value.trim();
    const qty = Number(div.querySelector('.pl-qty').value)||0;
    const cost = div.querySelector('.pl-cost').value.trim();
    return { item, qty, unitCost: cost };
  }).filter(l=>l.item && l.qty>0);
  if(lines.length===0){ alert('Add at least one valid line'); return; }
  const pr = { id: uid('pr'), requester: state.currentUser.username, status: 'Pending', lines, ts: now() };
  state.purchaseRequests.unshift(pr);
  audit('create PR', state.currentUser.username, { prId: pr.id, linesCount: lines.length });
  // clear lines and add fresh one
  prLinesContainer.innerHTML = ''; addPrLine();
  save(); renderRequests(); renderAll();
  alert('Purchase request submitted — PR# ' + pr.id);
});

// render requests table
function renderRequests(){
  const tbody = document.querySelector('#requestsTable tbody'); if(!tbody) return;
  tbody.innerHTML = '';
  state.purchaseRequests.forEach(pr=>{
    const tr = document.createElement('tr');
    const linesSummary = pr.lines.map(l=>`${l.item}×${l.qty}`).join('<br>');
    tr.innerHTML = `<td>${pr.id}</td><td>${linesSummary}</td><td>${pr.requester}</td><td>${pr.status}</td>
      <td>
        ${pr.status === 'Pending' && state.currentUser && state.currentUser.role==='office' ? `<button class="btn" data-approve="${pr.id}">Approve</button>` : ''}
        ${pr.status === 'Approved' ? `<button class="btn" data-deliver="${pr.id}">Mark Delivered</button>` : ''}
        <button class="btn" data-view="${pr.id}">View</button>
      </td>`;
    tbody.appendChild(tr);
  });
}

// approve PR (office only)
document.querySelector('#requestsTable tbody').addEventListener('click', e=>{
  const appr = e.target.closest('[data-approve]'); if(appr){ const id = appr.dataset.approve; const pr = state.purchaseRequests.find(x=>x.id===id); if(pr){ pr.status='Approved'; audit('approve PR', state.currentUser?state.currentUser.username:'system',{id}); save(); renderRequests(); renderAll(); } }
  const del = e.target.closest('[data-deliver]'); if(del){ const id = del.dataset.deliver; const pr = state.purchaseRequests.find(x=>x.id===id); if(pr){ // create delivery rows matching lines
      pr.status='Delivered'; const delivery = { id: uid('d'), prId: pr.id, ts: now(), lines: pr.lines, receivedBy: state.currentUser?state.currentUser.username:'system' }; state.deliveries.unshift(delivery);
      // add to inventory (onhand += qty)
      pr.lines.forEach(l=>{ const it = state.inventory.find(x=>x.name.toLowerCase()===l.item.toLowerCase() || x.sku===l.sku); if(it){ it.onhand += Number(l.qty); } else { state.inventory.push({ id: uid('i'), name: l.item, sku: l.sku||'', onhand: Number(l.qty), min:0, max:0 }); } });
      audit('deliver PR', state.currentUser?state.currentUser.username:'system',{prId: pr.id}); save(); renderRequests(); renderDeliveries(); renderInventory(); renderAll();
  } }
  const view = e.target.closest('[data-view]'); if(view){ const id = view.dataset.view; const pr = state.purchaseRequests.find(x=>x.id===id); if(pr){ alert('PR ' + pr.id + '\n\n' + pr.lines.map(l=>`${l.item} × ${l.qty} (cost: ${l.unitCost||'-'})`).join('\n')); } }
});

function renderDeliveries(){
  const tbody = document.querySelector('#deliveriesTable tbody'); if(!tbody) return;
  tbody.innerHTML = '';
  state.deliveries.forEach(d=>{
    d.lines.forEach(line=>{
      const tr = document.createElement('tr');
      tr.innerHTML = `<td>${d.prId}</td><td>${line.item}</td><td>${line.qty}</td><td>${line.qty}</td><td>${d.id}</td><td>Received</td><td>-</td>`;
      tbody.appendChild(tr);
    });
  });
}

// --- Audit view ---
function renderAudit(){
  const ul = document.getElementById('auditList'); if(!ul) return;
  ul.innerHTML=''; state.audit.forEach(a=>{ const li = document.createElement('li'); li.textContent = `${a.ts} — ${a.by}: ${a.action}`; ul.appendChild(li); });
}
document.getElementById('exportAudit').addEventListener('click', ()=>{
  const data = JSON.stringify(state.audit, null, 2); const blob = new Blob([data], {type:'application/json'}); const url = URL.createObjectURL(blob); const a = document.createElement('a'); a.href = url; a.download = 'audit.json'; a.click(); URL.revokeObjectURL(url);
});
document.getElementById('clearAudit').addEventListener('click', ()=>{ if(confirm('Clear audit log?')){ state.audit = []; save(); renderAudit(); renderRecentActivity(); } });

// --- Stats ---
function renderStats(){
  $('#stat-skus').textContent = state.inventory.length;
  $('#stat-onhand').textContent = state.inventory.reduce((s,i)=>s + Number(i.onhand||0), 0);
  $('#stat-pending').textContent = state.purchaseRequests.filter(p=>p.status==='Pending').length;
  $('#stat-awaiting').textContent = state.purchaseRequests.filter(p=>p.status==='Approved').length;
}

// --- render everything ---
function renderAll(){
  renderInventory(); renderRequests(); renderDeliveries(); renderAudit(); renderRecentActivity(); renderStats();
  // update visibility or UI based on currentUser
  const authBtn = document.querySelector('[data-open="modal-auth"]'); if(state.currentUser){ authBtn.textContent = state.currentUser.name + ' — ' + (state.currentUser.role); } else { authBtn.textContent = 'Login'; }
}
renderAll();
