const get = (id) => document.getElementById(id);
const status = get('status');
const tokenKey = 'muttonblock-secret-santa-ticket';
const tokenPattern = /^[a-f0-9]{64}$/;
const { url, key } = window.SANTA_CONFIG;

function savedTicket() {
  try {
    return localStorage.getItem(tokenKey);
  } catch {
    return null;
  }
}

function saveTicket(ticket) {
  try {
    localStorage.setItem(tokenKey, ticket);
  } catch {
    // The private link still works with browser storage disabled.
  }
}

function drawUrl(ticket) {
  const link = new URL(location.href);
  link.hash = 'draw/' + ticket;
  return link.href;
}

function route() {
  const [page, ticket] = location.hash.slice(1).split('/');
  const active = ['signup', 'draw', 'organizer'].includes(page) ? page : 'home';
  for (const id of ['home', 'signup', 'draw', 'organizer']) get(id).hidden = id !== active;
  if (active === 'draw' && tokenPattern.test(ticket ?? '')) saveTicket(ticket);
  const hasTicket = tokenPattern.test(savedTicket() ?? '') ||
    (active === 'draw' && tokenPattern.test(ticket ?? ''));
  get('reveal').hidden = !hasTicket;
  get('draw-hint').hidden = hasTicket;
  get('match').textContent = '';
  get('roster').textContent = '';
  status.textContent = '';
}

async function rpc(action, payload) {
  if (key === 'YOUR_SUPABASE_PUBLISHABLE_KEY') {
    throw Error('The organizer still needs to connect the signup database.');
  }
  const response = await fetch(url.replace(/\/$/, '') + '/rest/v1/rpc/muttonblock_santa', {
    method: 'POST',
    headers: { apikey: key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ action, payload }),
  });
  if (!response.ok) throw Error('Could not connect to the draw. Please try again.');
  const result = await response.json();
  if (result.error) throw Error(result.error);
  return result;
}

async function run(control, work) {
  if (control.disabled) return;
  control.disabled = true;
  status.textContent = '';
  try {
    await work();
  } catch (error) {
    status.textContent = error.message;
  } finally {
    control.disabled = false;
  }
}

const scroogePopup = get('scrooge-popup');

get('decline').onclick = () => {
  scroogePopup.showModal();
};

get('close-scrooge').onclick = () => {
  scroogePopup.close();
};
get('join').onclick = () => { location.hash = 'signup'; };
const entry = get('entry');
let pendingTicket;
entry.onsubmit = (event) => {
  event.preventDefault();
  const fields = new FormData(entry);
  run(event.submitter, async () => {
    pendingTicket ??= Array.from(crypto.getRandomValues(new Uint8Array(32)),
      (byte) => byte.toString(16).padStart(2, '0')).join('');
    await rpc('join', { ...Object.fromEntries(fields), ticket: pendingTicket });
    saveTicket(pendingTicket);
    const link = drawUrl(pendingTicket);
    get('draw-link').value = link;
    get('open-draw').href = link;
    entry.hidden = true;
    get('receipt').hidden = false;
  });
};

get('copy').onclick = async () => {
  get('draw-link').select();
  try {
    await navigator.clipboard.writeText(get('draw-link').value);
    status.textContent = 'Private link copied.';
  } catch {
    status.textContent = 'Copy the selected link to keep it.';
  }
};

const reveal = get('reveal');
reveal.onclick = () => run(reveal, async () => {
  const linkTicket = location.hash.split('/')[1];
  const ticket = tokenPattern.test(linkTicket ?? '') ? linkTicket : savedTicket();
  const result = await rpc('reveal', { ticket });
  get('match').textContent = result.waiting
    ? 'The draw is still waiting for the organizer.'
    : 'You’re buying for ' + result.name + '!\n\n' + (result.wishes || 'No wish list added.');
});

const manage = get('manage');
manage.onsubmit = (event) => {
  event.preventDefault();
  const action = event.submitter.value;
  if (action === 'draw' && !confirm('Has everyone joined? This closes signups and runs the final draw.')) return;
  const buttons = Array.from(manage.querySelectorAll('button'));
  const other = buttons.find((button) => button !== event.submitter);
  other.disabled = true;
  run(event.submitter, async () => {
    const result = await rpc(action, { code: new FormData(manage).get('code') });
    get('roster').textContent = (result.closed ? 'Draw complete. ' : 'Signups open. ') +
      result.names.length + ' joined' + (result.names.length ? ' — ' + result.names.join(', ') : '.');
  }).finally(() => { other.disabled = false; });
};

window.addEventListener('hashchange', route);
route();
const wishlistPanel = get('wishlist-panel');
const wishlistForm = get('wishlist-form');
const wishlistInput = get('my-wishes');
const wishlistStatus = get('wishlist-status');
const loadWishlist = get('load-wishlist');
let editingTicket = null;

function currentWishlistTicket() {
  const [page, linkTicket] = location.hash.slice(1).split('/');
  if (page !== 'draw') return null;
  if (tokenPattern.test(linkTicket ?? '')) return linkTicket;

  const ticket = savedTicket();
  return tokenPattern.test(ticket ?? '') ? ticket : null;
}

function resetWishlist() {
  wishlistPanel.hidden = !currentWishlistTicket();
  wishlistForm.hidden = true;
  wishlistInput.value = '';
  wishlistStatus.textContent = '';
  editingTicket = null;
}

loadWishlist.onclick = () => {
  const ticket = currentWishlistTicket();
  if (!ticket) return;

  run(loadWishlist, async () => {
    const result = await rpc('get', { ticket }, 'muttonblock_wishlist');
    if (currentWishlistTicket() !== ticket) return;

    editingTicket = ticket;
    wishlistInput.value = result.wishes ?? '';
    wishlistForm.hidden = false;
    wishlistStatus.textContent = '';
    wishlistInput.focus();
  });
};

wishlistForm.onsubmit = (event) => {
  event.preventDefault();

  const ticket = currentWishlistTicket();
  if (!ticket || ticket !== editingTicket) return;

  const wishes = wishlistInput.value;
  wishlistStatus.textContent = '';

  run(event.submitter, async () => {
    await rpc('save', { ticket, wishes }, 'muttonblock_wishlist');
    if (currentWishlistTicket() === ticket && editingTicket === ticket) {
      wishlistStatus.textContent = 'Your wish list was saved.';
    }
  });
};

window.addEventListener('hashchange', resetWishlist);
resetWishlist();
