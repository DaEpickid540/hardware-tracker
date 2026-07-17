// ============================================================
//  app.js — Forge Hardware Tracker UI controller
// ============================================================
import * as store from "./store.js";
import { ask, PROVIDERS, SEARCH_PROVIDERS } from "./aria.js";
import { encryptString, decryptString, isEncrypted } from "./crypto.js";

// ── App state ────────────────────────────────────────────────
const state = {
  classes: [], groups: [], categories: [], subcategories: [], items: [], conversations: [],
  expandedCats: new Set(),  // which categories are expanded to show subcategories
  settings: {},
  decryptedKeys: {},        // in-memory plaintext keys when encryption is unlocked
  keyPass: null, unlocked: false,
  activeClassId: "all",        // "all" or a class id
  activeGroupId: "all",        // "all" or a group id (sidebar category filter)
  activeCategoryId: "all",     // "all" or a category id
  activeSubcategoryId: null,   // null or a subcategory id
  classFilterId: "all",        // chip filter used in "all classes" view
  search: "",
  activeConvId: null,
  aria: { open: false, busy: false, messages: [] },
  unsub: [],
};

const $  = (s, r = document) => r.querySelector(s);
const el = (tag, cls, html) => { const n = document.createElement(tag); if (cls) n.className = cls; if (html != null) n.innerHTML = html; return n; };
const esc = (s) => (s ?? "").replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
let onGroupsChanged = null; // lets an open Groups modal refresh on live updates

// ── Custom dropdown (no native <select> — better on mobile) ──
// options: [{value, label}]. Returns an element with getValue/setValue/setOptions.
function makeSelect(options, value, onChange, placeholder = "Select") {
  let opts = options.slice();
  let val = value ?? "";
  const wrap = el("div", "cselect");
  wrap.innerHTML = `<button type="button" class="cselect-btn">
      <span class="cselect-val"></span><i class="fa-solid fa-chevron-down chev"></i></button>
    <div class="cselect-menu" hidden></div>`;
  const btn  = wrap.querySelector(".cselect-btn");
  const menu = wrap.querySelector(".cselect-menu");
  const valEl = wrap.querySelector(".cselect-val");
  const labelFor = (v) => (opts.find((o) => o.value === v)?.label) ?? placeholder;
  const paint = () => { valEl.textContent = labelFor(val); };
  const close = () => { menu.hidden = true; wrap.classList.remove("open"); };
  const open = () => {
    menu.innerHTML = "";
    opts.forEach((o) => {
      const it = el("button", "cselect-opt" + (o.value === val ? " sel" : ""), esc(o.label));
      it.type = "button";
      it.onclick = (e) => { e.stopPropagation(); val = o.value; paint(); close(); onChange && onChange(val); };
      menu.appendChild(it);
    });
    menu.hidden = false; wrap.classList.add("open");
  };
  btn.onclick = (e) => { e.stopPropagation(); menu.hidden ? open() : close(); };
  document.addEventListener("click", (e) => { if (!wrap.contains(e.target)) close(); });
  wrap.getValue = () => val;
  wrap.setValue = (v) => { val = v ?? ""; paint(); };
  wrap.setOptions = (o) => { opts = o.slice(); if (!opts.some((x) => x.value === val)) val = ""; paint(); };
  paint();
  return wrap;
}

// ── Mobile sidebar ───────────────────────────────────────────
function openSidebar()  { $(".sidebar").classList.add("open"); $("#sidebar-overlay").classList.add("show"); }
function closeSidebar() { $(".sidebar").classList.remove("open"); $("#sidebar-overlay").classList.remove("show"); }
function closeSidebarMobile() { if (window.matchMedia("(max-width: 760px)").matches) closeSidebar(); }
$("#mobile-menu-btn").onclick = openSidebar;
$("#sidebar-overlay").onclick = closeSidebar;

const ICONS = ["fa-microchip", "fa-battery-full", "fa-memory", "fa-bolt", "fa-wifi", "fa-gauge-high",
  "fa-plug", "fa-lightbulb", "fa-fan", "fa-satellite-dish", "fa-screwdriver-wrench", "fa-robot",
  "fa-temperature-half", "fa-camera", "fa-server", "fa-layer-group"];
const COLORS = ["#e74c3c", "#2980b9", "#27ae60", "#8e44ad", "#e67e22", "#607d8b", "#f1c40f"];

// ── Boot ─────────────────────────────────────────────────────
store.onAuth((user) => {
  if (user) { showApp(); subscribe(); loadSettings(); store.upsertUnifiedUser(user).catch(() => {}); }
  else { showLogin(); teardown(); }
});

function showLogin() { $("#login-screen").hidden = false; $("#app-shell").hidden = true; }
function showApp()   { $("#login-screen").hidden = true;  $("#app-shell").hidden = false; }

function subscribe() {
  teardown();
  state.unsub.push(store.watchClasses((rows)    => { state.classes = rows; renderClasses(); renderChips(); }));
  state.unsub.push(store.watchGroups((rows)     => { state.groups = rows; renderGroupBox(); renderCategories(); if (onGroupsChanged) onGroupsChanged(); }));
  state.unsub.push(store.watchCategories((rows) => { state.categories = rows; renderCategories(); render(); }));
  state.unsub.push(store.watchSubcategories((rows) => { state.subcategories = rows; renderCategories(); render(); }));
  state.unsub.push(store.watchItems((rows)      => { state.items = rows; renderCategories(); render(); }));
  state.unsub.push(store.watchConversations((rows) => { state.conversations = rows; renderHistory(); }));
}
function teardown() { state.unsub.forEach((u) => u && u()); state.unsub = []; }

async function loadSettings() {
  state.settings = await store.getSettings();
  if (!state.settings.theme) state.settings.theme = "dark";
  document.documentElement.setAttribute("data-theme", state.settings.theme);
}

// ── SIDEBAR: classes ─────────────────────────────────────────
function activeClass() { return state.classes.find((c) => c.id === state.activeClassId); }

function renderClasses() {
  const ac = activeClass();
  $("#active-class-name").textContent = ac ? ac.name : "All Classes";
  const menu = $("#class-menu");
  menu.innerHTML = "";
  const all = el("button", "class-menu-item" + (state.activeClassId === "all" ? " active" : ""),
    `<span class="dot" style="background:var(--text-3)"></span> All Classes`);
  all.onclick = () => { state.activeClassId = "all"; closeClassMenu(); renderClasses(); render(); };
  menu.appendChild(all);
  state.classes.forEach((c) => {
    const it = el("button", "class-menu-item" + (state.activeClassId === c.id ? " active" : ""),
      `<span class="dot" style="background:${c.color}"></span><span>${esc(c.name)}</span>
       <i class="fa-solid fa-pen edit" title="Edit"></i>`);
    it.querySelector("span:nth-child(2)").onclick = (e) => { e.stopPropagation(); };
    it.onclick = () => { state.activeClassId = c.id; closeClassMenu(); renderClasses(); render(); };
    it.querySelector(".edit").onclick = (e) => { e.stopPropagation(); closeClassMenu(); classModal(c); };
    menu.appendChild(it);
  });
}
function closeClassMenu() { $("#class-menu").hidden = true; }
$("#class-switch").onclick = () => { const m = $("#class-menu"); m.hidden = !m.hidden; };
$("#add-class-btn").onclick = () => classModal();

// ── SIDEBAR: categories ──────────────────────────────────────
function itemsInClass() {
  return state.activeClassId === "all"
    ? state.items
    : state.items.filter((i) => i.classId === state.activeClassId);
}
// items in the active class AND active group filter (groups are item-level tags)
function inActiveGroup(i) {
  return state.activeGroupId === "all" || (i.groupIds || []).includes(state.activeGroupId);
}
function scopedItems() { return itemsInClass().filter(inActiveGroup); }

function renderCategories() {
  const nav = $("#cat-nav");
  nav.innerHTML = "";
  const scopeItems = scopedItems();
  const cats = state.categories;

  const allActive = state.activeCategoryId === "all";
  const allBtn = el("button", "cat-item" + (allActive ? " active" : ""),
    `<span class="caret"></span><i class="fa-solid fa-grip lead"></i><span>All Components</span>
     <span class="count">${scopeItems.length}</span>`);
  allBtn.onclick = () => { state.activeCategoryId = "all"; state.activeSubcategoryId = null; renderCategories(); render(); closeSidebarMobile(); };
  nav.appendChild(allBtn);

  if (!cats.length) {
    nav.appendChild(el("div", "cat-empty", "No categories yet. Click + to add one (e.g. ESP32, 18650)."));
    return;
  }

  cats.forEach((c) => {
    const subs = state.subcategories.filter((s) => s.categoryId === c.id);
    const expanded = state.expandedCats.has(c.id);
    const count = scopeItems.filter((i) => i.categoryId === c.id).length;
    const isActive = state.activeCategoryId === c.id && !state.activeSubcategoryId;
    const row = el("button", "cat-item" + (isActive ? " active" : ""),
      `<span class="caret">${subs.length ? `<i class="fa-solid fa-chevron-${expanded ? "down" : "right"}"></i>` : ""}</span>
       <i class="fa-solid ${c.icon} lead"></i><span>${esc(c.name)}</span>
       <i class="fa-solid fa-plus add-sub" title="Add subcategory"></i>
       <i class="fa-solid fa-pen edit" title="Edit"></i>
       <span class="count">${count}</span>`);
    row.onclick = () => {
      state.activeCategoryId = c.id; state.activeSubcategoryId = null;
      if (subs.length) state.expandedCats.add(c.id);
      renderCategories(); render(); closeSidebarMobile();
    };
    row.querySelector(".caret").onclick = (e) => {
      if (!subs.length) return;
      e.stopPropagation();
      if (expanded) state.expandedCats.delete(c.id); else state.expandedCats.add(c.id);
      renderCategories();
    };
    row.querySelector(".add-sub").onclick = (e) => { e.stopPropagation(); subcategoryModal(null, c.id); };
    row.querySelector(".edit").onclick = (e) => { e.stopPropagation(); categoryModal(c); };
    nav.appendChild(row);

    if (expanded) {
      const body = el("div", "subcat-body");
      subs.forEach((s) => {
        const scount = scopeItems.filter((i) => i.subcategoryId === s.id).length;
        const sit = el("button", "subcat-item" + (state.activeSubcategoryId === s.id ? " active" : ""),
          `<span class="dot2"></span><span class="sname">${esc(s.name)}</span>
           <i class="fa-solid fa-pen edit"></i><span class="count">${scount}</span>`);
        sit.onclick = () => { state.activeCategoryId = c.id; state.activeSubcategoryId = s.id; renderCategories(); render(); closeSidebarMobile(); };
        sit.querySelector(".edit").onclick = (e) => { e.stopPropagation(); subcategoryModal(s, c.id); };
        body.appendChild(sit);
      });
      const add = el("button", "subcat-add", `<i class="fa-solid fa-plus"></i> Add subcategory`);
      add.onclick = () => subcategoryModal(null, c.id);
      body.appendChild(add);
      nav.appendChild(body);
    }
  });
}
$("#add-category-btn").onclick = () => categoryModal();

// ── Group box (bottom of sidebar) ────────────────────────────
function renderGroupBox() {
  const g = state.groups.find((x) => x.id === state.activeGroupId);
  $("#group-box-name").textContent = g ? g.name : "All Groups";
}
$("#group-box").onclick = () => groupsModal();

// ── class filter chips (All Classes view) ────────────────────
function renderChips() {
  const row = $("#class-chip-row");
  if (state.activeClassId !== "all" || !state.classes.length) { row.hidden = true; return; }
  row.hidden = false;
  row.innerHTML = "";
  const mk = (id, label, color) => {
    const c = el("button", "class-chip" + (state.classFilterId === id ? " selected" : ""),
      `${color ? `<span class="dot" style="background:${color}"></span>` : ""}${esc(label)}`);
    c.onclick = () => { state.classFilterId = id; renderChips(); render(); };
    return c;
  };
  row.appendChild(mk("all", "All", null));
  state.classes.forEach((c) => row.appendChild(mk(c.id, c.name, c.color)));
}

// ── MAIN: render the option grid ─────────────────────────────
function visibleItems() {
  let items = scopedItems();
  if (state.activeSubcategoryId) {
    items = items.filter((i) => i.subcategoryId === state.activeSubcategoryId);
  } else if (state.activeCategoryId !== "all") {
    items = items.filter((i) => i.categoryId === state.activeCategoryId);
  }
  if (state.activeClassId === "all" && state.classFilterId !== "all")
    items = items.filter((i) => i.classId === state.classFilterId);
  if (state.search) {
    const q = state.search.toLowerCase();
    items = items.filter((i) =>
      (i.name || "").toLowerCase().includes(q) ||
      (i.info || "").toLowerCase().includes(q) ||
      (i.link || "").toLowerCase().includes(q));
  }
  return items;
}

function render() {
  const cat = state.categories.find((c) => c.id === state.activeCategoryId);
  const sub = state.subcategories.find((s) => s.id === state.activeSubcategoryId);
  $("#view-title").textContent = sub ? sub.name : (cat ? cat.name : "All Components");
  const grid = $("#option-grid");
  const empty = $("#empty-grid");
  grid.innerHTML = "";
  const items = visibleItems();

  items.forEach((i) => grid.appendChild(optionCard(i)));

  // add-option tile
  const add = el("button", "add-card", `<i class="fa-solid fa-plus"></i><span>Add Option</span>`);
  add.onclick = () => itemModal();
  grid.appendChild(add);

  if (!items.length && state.search) {
    empty.hidden = false;
    empty.innerHTML = `<i class="fa-solid fa-magnifying-glass"></i><p>No components match “${esc(state.search)}”.</p>`;
  } else { empty.hidden = true; }
}

function optionCard(i) {
  const cat = state.categories.find((c) => c.id === i.categoryId);
  const sub = state.subcategories.find((s) => s.id === i.subcategoryId);
  const cls = state.classes.find((c) => c.id === i.classId);
  const qty = i.quantity ?? 1;
  const card = el("div", "option-card" + (i.pinned ? " pinned" : ""));

  const embedUrl = i.embedUrl || i.link;
  const media = (i.mediaType === "embed" && embedUrl)
    ? `<div class="option-card-embed">
         <iframe src="${esc(embedUrl)}" loading="lazy" referrerpolicy="no-referrer"
           sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
         <button class="embed-expand" title="Expand to read"><span class="embed-expand-hint"><i class="fa-solid fa-expand"></i> Tap to expand</span></button>
         <a class="embed-open" href="${esc(embedUrl)}" target="_blank" rel="noopener" title="Open in new tab"><i class="fa-solid fa-up-right-from-square"></i></a>
       </div>`
    : (i.photoUrl
        ? `<img class="option-card-photo" src="${esc(i.photoUrl)}" alt="" onerror="this.outerHTML='<div class=\\'option-card-photo-ph\\'><i class=\\'fa-solid fa-microchip\\'></i></div>'">`
        : `<div class="option-card-photo-ph"><i class="fa-solid ${cat ? cat.icon : "fa-microchip"}"></i></div>`);

  const tags = [];
  if (cat) tags.push(`<span class="mini-tag"><i class="fa-solid ${cat.icon}"></i>${esc(cat.name)}${sub ? " · " + esc(sub.name) : ""}</span>`);
  if (cls) tags.push(`<span class="mini-tag"><span class="dot" style="background:${cls.color}"></span>${esc(cls.name)}</span>`);
  (i.groupIds || []).forEach((gid) => {
    const g = state.groups.find((x) => x.id === gid);
    if (g) tags.push(`<span class="mini-tag"><i class="fa-solid fa-folder"></i>${esc(g.name)}</span>`);
  });

  const qtyCls = qty === 0 ? "zero" : (qty <= 2 ? "low" : "");
  card.innerHTML = `
    ${media}
    <div class="option-card-head">
      <div class="option-card-title">${esc(i.name)}</div>
      <button class="pin-btn ${i.pinned ? "on" : ""}" title="Pin"><i class="fa-solid fa-thumbtack"></i></button>
    </div>
    <div class="qty-row">
      <span class="qty-label">In stock</span>
      <div class="qty-ctrl">
        <button class="qty-btn minus" title="Use one">−</button>
        <span class="qty-val ${qtyCls}">${qty}</span>
        <button class="qty-btn plus" title="New shipment">+</button>
      </div>
    </div>
    ${i.info ? `<div class="option-card-info">${esc(i.info)}</div>` : ""}
    ${tags.length ? `<div class="option-card-tags">${tags.join("")}</div>` : ""}
    <div class="option-card-foot">
      ${i.link ? `<a href="${esc(i.link)}" target="_blank" rel="noopener"><i class="fa-solid fa-link"></i> Link</a>` : ""}
      <span class="spacer"></span>
      <button class="card-action group" title="Add to group"><i class="fa-solid fa-folder-plus"></i></button>
      <button class="card-action edit" title="Edit"><i class="fa-solid fa-pen"></i></button>
      <button class="card-action del" title="Delete"><i class="fa-solid fa-trash"></i></button>
    </div>`;
  card.querySelector(".pin-btn").onclick = () => store.togglePin(i.id, !i.pinned);
  card.querySelector(".qty-btn.minus").onclick = () => store.updateItem(i.id, { quantity: Math.max(0, qty - 1) });
  card.querySelector(".qty-btn.plus").onclick  = () => store.updateItem(i.id, { quantity: qty + 1 });
  card.querySelector(".group").onclick = () => groupAssignModal(i);
  card.querySelector(".edit").onclick = () => itemModal(i);
  card.querySelector(".del").onclick = () => confirmDelete(`Delete “${i.name}”?`, () => store.deleteItem(i.id));
  const exp = card.querySelector(".embed-expand");
  if (exp) exp.onclick = () => embedModal(embedUrl, i.name);
  return card;
}

// ── Embed modal (big iframe to read specs in place) ──────────
function embedModal(url, title) {
  const m = el("div", "modal modal--embed");
  m.innerHTML = `
    <div class="modal-head">
      <div class="modal-title">${esc(title)}</div>
      <div class="embed-head-actions">
        <a class="icon-btn" href="${esc(url)}" target="_blank" rel="noopener" title="Open in new tab"><i class="fa-solid fa-up-right-from-square"></i></a>
        <button class="modal-close" title="Close"><i class="fa-solid fa-xmark"></i></button>
      </div>
    </div>
    <div class="embed-modal-body">
      <iframe src="${esc(url)}" referrerpolicy="no-referrer" sandbox="allow-scripts allow-same-origin allow-popups allow-forms"></iframe>
    </div>`;
  const overlay = openModal(m);
  m.querySelector(".modal-close").onclick = () => overlay.remove();
}

// ── Add-to-group modal (multi-select for one item) ───────────
function groupAssignModal(item) {
  const m = modalShell(`Groups for “${item.name}”`, `
    <p class="form-hint">An item can belong to multiple groups. Toggle them on/off.</p>
    <div class="gassign" id="gassign"></div>
    <div class="gadd-row">
      <input class="text-input" id="g-new" placeholder="New group name">
      <button class="btn btn--primary" id="g-add"><i class="fa-solid fa-plus"></i> Add</button>
    </div>`, true);
  const overlay = openModal(m);
  const box = m.querySelector("#gassign");
  let ids = [...(item.groupIds || [])];

  const renderBox = () => {
    box.innerHTML = "";
    if (!state.groups.length) { box.appendChild(el("div", "gassign-empty", "No groups yet — create one below.")); return; }
    state.groups.forEach((g) => {
      const on = ids.includes(g.id);
      const row = el("button", "gcheck" + (on ? " on" : ""),
        `<i class="fa-solid ${on ? "fa-square-check" : "fa-square"} box"></i><span class="gn">${esc(g.name)}</span>`);
      row.type = "button";
      row.onclick = async () => {
        ids = on ? ids.filter((x) => x !== g.id) : [...ids, g.id];
        await store.updateItem(item.id, { groupIds: ids });
        item.groupIds = ids; renderBox();
      };
      box.appendChild(row);
    });
  };
  renderBox();
  onGroupsChanged = renderBox;

  m.querySelector("#g-add").onclick = async () => {
    const inp = m.querySelector("#g-new");
    const name = inp.value.trim();
    if (!name) return toast("Enter a group name", "danger");
    await store.addGroup({ name });
    inp.value = ""; toast("Group created", "success");
  };
  const close = () => { onGroupsChanged = null; overlay.remove(); };
  m.querySelector(".modal-close").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) onGroupsChanged = null; });
  const foot = m.querySelector(".modal-foot");
  const done = el("button", "btn btn--ghost", "Done"); done.onclick = close;
  foot.appendChild(done);
}

$("#add-item-btn").onclick = () => itemModal();
$("#search-input").oninput = (e) => { state.search = e.target.value.trim(); render(); };

// ============================================================
//  MODALS
// ============================================================
function openModal(node) {
  const overlay = el("div", "modal-overlay");
  overlay.appendChild(node);
  overlay.onclick = (e) => { if (e.target === overlay) overlay.remove(); };
  $("#modal-host").appendChild(overlay);
  const first = node.querySelector("input, textarea, select");
  if (first) setTimeout(() => first.focus(), 40);
  return overlay;
}
function modalShell(title, bodyHtml, wide) {
  const m = el("div", "modal" + (wide ? " modal--wide" : ""));
  m.innerHTML = `
    <div class="modal-head"><div class="modal-title">${esc(title)}</div>
      <button class="modal-close"><i class="fa-solid fa-xmark"></i></button></div>
    <div class="modal-body">${bodyHtml}</div>
    <div class="modal-foot"></div>`;
  return m;
}

function iconPicker(selected) {
  return `<div class="icon-picker">${ICONS.map((ic) =>
    `<button type="button" class="icon-opt ${ic === selected ? "sel" : ""}" data-icon="${ic}"><i class="fa-solid ${ic}"></i></button>`).join("")}</div>`;
}
function colorPicker(selected) {
  return `<div class="color-picker">${COLORS.map((c) =>
    `<button type="button" class="color-opt ${c === selected ? "sel" : ""}" data-color="${c}" style="background:${c}"></button>`).join("")}</div>`;
}
function wirePicker(root, cls, attr, set) {
  root.querySelectorAll("." + cls).forEach((b) => b.onclick = () => {
    root.querySelectorAll("." + cls).forEach((x) => x.classList.remove("sel"));
    b.classList.add("sel"); set(b.dataset[attr]);
  });
}

// ── Class modal ──────────────────────────────────────────────
function classModal(existing) {
  let icon = existing?.icon || "fa-layer-group";
  let color = existing?.color || "#e74c3c";
  const m = modalShell(existing ? "Edit Class" : "New Class", `
    <div class="form-group"><label class="form-label">Class name</label>
      <input class="text-input" id="f-name" placeholder="e.g. Drone v2, Lantern" value="${esc(existing?.name || "")}"></div>
    <div class="form-group"><label class="form-label">Color</label>${colorPicker(color)}</div>
    <div class="form-group"><label class="form-label">Icon</label>${iconPicker(icon)}</div>
    <p class="form-hint">Classes are project workspaces. Switch between them at the top of the sidebar, or view "All Classes" and filter with chips.</p>`);
  const overlay = openModal(m);
  wirePicker(m, "color-opt", "color", (v) => color = v);
  wirePicker(m, "icon-opt", "icon", (v) => icon = v);
  const foot = m.querySelector(".modal-foot");
  if (existing) {
    const del = el("button", "btn btn--danger", `<i class="fa-solid fa-trash"></i> Delete`);
    del.onclick = () => confirmDelete(`Delete class “${existing.name}”? Items keep their data but lose this class tag.`,
      async () => { await store.deleteClass(existing.id); if (state.activeClassId === existing.id) state.activeClassId = "all"; overlay.remove(); renderClasses(); render(); });
    foot.appendChild(del);
  }
  const save = el("button", "btn btn--primary", existing ? "Save" : "Create");
  save.onclick = async () => {
    const name = m.querySelector("#f-name").value.trim();
    if (!name) return toast("Enter a class name", "danger");
    if (existing) await store.updateClass(existing.id, { name, icon, color });
    else await store.addClass({ name, icon, color });
    overlay.remove(); toast(existing ? "Class updated" : "Class created", "success");
  };
  m.querySelector(".modal-close").onclick = () => overlay.remove();
  foot.appendChild(save);
}

// ── Group modal (sidebar subsection) ─────────────────────────
function groupModal(existing) {
  const m = modalShell(existing ? "Edit Group" : "New Group", `
    <div class="form-group"><label class="form-label">Group name</label>
      <input class="text-input" id="f-name" placeholder="e.g. Boards, Power, Sensors" value="${esc(existing?.name || "")}"></div>
    <p class="form-hint">Groups tag items across categories (e.g. “Boards”, “Drone build”). Add items to a group with the folder button on each card.</p>`);
  const overlay = openModal(m);
  const foot = m.querySelector(".modal-foot");
  if (existing) {
    const del = el("button", "btn btn--danger", `<i class="fa-solid fa-trash"></i> Delete`);
    del.onclick = () => confirmDelete(`Delete group “${existing.name}”? Items keep their data but lose this group tag.`,
      async () => {
        const tagged = state.items.filter((i) => (i.groupIds || []).includes(existing.id));
        await Promise.all(tagged.map((i) => store.updateItem(i.id, { groupIds: (i.groupIds || []).filter((x) => x !== existing.id) })));
        await store.deleteGroup(existing.id);
        if (state.activeGroupId === existing.id) state.activeGroupId = "all";
        overlay.remove(); renderGroupBox(); renderCategories(); render();
      });
    foot.appendChild(del);
  }
  const save = el("button", "btn btn--primary", existing ? "Save" : "Create");
  save.onclick = async () => {
    const name = m.querySelector("#f-name").value.trim();
    if (!name) return toast("Enter a group name", "danger");
    if (existing) await store.updateGroup(existing.id, { name });
    else await store.addGroup({ name });
    overlay.remove(); toast(existing ? "Group updated" : "Group created", "success");
  };
  m.querySelector(".modal-close").onclick = () => overlay.remove();
  foot.appendChild(save);
}

// ── Groups modal (filter + manage) ───────────────────────────
function groupsModal() {
  const m = modalShell("Groups", `
    <p class="form-hint">Groups tag items across categories (e.g. “Boards”, “Drone build”). Pick one to filter, or manage them here. Add an item to a group with the <i class="fa-solid fa-folder-plus"></i> button on its card — an item can be in several groups.</p>
    <div class="glist" id="glist"></div>
    <div class="gadd-row">
      <input class="text-input" id="g-new" placeholder="New group name (e.g. Boards)">
      <button class="btn btn--primary" id="g-add"><i class="fa-solid fa-plus"></i> Add</button>
    </div>`, true);
  const overlay = openModal(m);
  const list = m.querySelector("#glist");

  const renderList = () => {
    list.innerHTML = "";
    const mkRow = (id, name, count, editable) => {
      const active = state.activeGroupId === id;
      const row = el("div", "grow" + (active ? " active" : ""),
        `<span class="gname">${esc(name)}</span><span class="gcount">${count}</span>
         ${editable ? `<button class="gact edit" title="Rename"><i class="fa-solid fa-pen"></i></button>
                       <button class="gact del" title="Delete"><i class="fa-solid fa-trash"></i></button>` : ""}`);
      row.querySelector(".gname").onclick = () => {
        state.activeGroupId = id; renderGroupBox(); renderCategories(); render(); overlay.remove(); closeSidebarMobile();
      };
      if (editable) {
        row.querySelector(".edit").onclick = () => { close(); groupModal(state.groups.find((g) => g.id === id)); };
        row.querySelector(".del").onclick = () => confirmDelete(
          `Delete group “${name}”? Items keep their data but lose this group tag.`,
          async () => {
            const tagged = state.items.filter((i) => (i.groupIds || []).includes(id));
            await Promise.all(tagged.map((i) => store.updateItem(i.id, { groupIds: (i.groupIds || []).filter((x) => x !== id) })));
            await store.deleteGroup(id);
            if (state.activeGroupId === id) state.activeGroupId = "all";
            renderGroupBox(); renderCategories(); render();
          });
      }
      return row;
    };
    list.appendChild(mkRow("all", "All Groups", state.items.length, false));
    state.groups.forEach((g) =>
      list.appendChild(mkRow(g.id, g.name, state.items.filter((i) => (i.groupIds || []).includes(g.id)).length, true)));
  };
  renderList();
  onGroupsChanged = renderList; // keep list live while open

  m.querySelector("#g-add").onclick = async () => {
    const inp = m.querySelector("#g-new");
    const name = inp.value.trim();
    if (!name) return toast("Enter a group name", "danger");
    await store.addGroup({ name });
    inp.value = ""; toast("Group created", "success");
  };
  const close = () => { onGroupsChanged = null; overlay.remove(); };
  m.querySelector(".modal-close").onclick = close;
  overlay.addEventListener("click", (e) => { if (e.target === overlay) onGroupsChanged = null; });
  const foot = m.querySelector(".modal-foot");
  const done = el("button", "btn btn--ghost", "Done"); done.onclick = close;
  foot.appendChild(done);
}

// ── Subcategory modal ────────────────────────────────────────
function subcategoryModal(existing, categoryId) {
  const cid = existing?.categoryId || categoryId;
  const cat = state.categories.find((c) => c.id === cid);
  const m = modalShell(existing ? "Edit Subcategory" : "New Subcategory", `
    <div class="form-group"><label class="form-label">Subcategory name</label>
      <input class="text-input" id="f-name" placeholder="e.g. ESP32-C3, 30Q cells" value="${esc(existing?.name || "")}"></div>
    <p class="form-hint">Nested under <b>${esc(cat ? cat.name : "category")}</b>.</p>`);
  const overlay = openModal(m);
  const foot = m.querySelector(".modal-foot");
  if (existing) {
    const del = el("button", "btn btn--danger", `<i class="fa-solid fa-trash"></i> Delete`);
    del.onclick = () => confirmDelete(`Delete subcategory “${existing.name}”? Items keep their data but lose this subcategory.`,
      async () => { await store.deleteSubcategory(existing.id); if (state.activeSubcategoryId === existing.id) state.activeSubcategoryId = null; overlay.remove(); renderCategories(); render(); });
    foot.appendChild(del);
  }
  const save = el("button", "btn btn--primary", existing ? "Save" : "Create");
  save.onclick = async () => {
    const name = m.querySelector("#f-name").value.trim();
    if (!name) return toast("Enter a subcategory name", "danger");
    if (existing) await store.updateSubcategory(existing.id, { name });
    else { await store.addSubcategory({ name, categoryId: cid }); state.expandedCats.add(cid); }
    overlay.remove(); toast(existing ? "Saved" : "Subcategory added", "success");
  };
  m.querySelector(".modal-close").onclick = () => overlay.remove();
  foot.appendChild(save);
}

// ── Category modal ───────────────────────────────────────────
function categoryModal(existing) {
  let icon = existing?.icon || "fa-microchip";
  const m = modalShell(existing ? "Edit Category" : "New Category", `
    <div class="form-group"><label class="form-label">Category name</label>
      <input class="text-input" id="f-name" placeholder="e.g. ESP32, 18650, Raspberry Pi" value="${esc(existing?.name || "")}"></div>
    <div class="form-group"><label class="form-label">Icon</label>${iconPicker(icon)}</div>
    <p class="form-hint">Categories are hardware types, shared across all your classes. Expand a category in the sidebar (caret) to add subcategories.</p>`);
  const overlay = openModal(m);
  wirePicker(m, "icon-opt", "icon", (v) => icon = v);
  const foot = m.querySelector(".modal-foot");
  if (existing) {
    const del = el("button", "btn btn--danger", `<i class="fa-solid fa-trash"></i> Delete`);
    del.onclick = () => confirmDelete(`Delete category “${existing.name}”? Its subcategories are removed; items become uncategorized.`,
      async () => {
        const subs = state.subcategories.filter((s) => s.categoryId === existing.id);
        await Promise.all(subs.map((s) => store.deleteSubcategory(s.id)));
        await store.deleteCategory(existing.id);
        if (state.activeCategoryId === existing.id) { state.activeCategoryId = "all"; state.activeSubcategoryId = null; }
        overlay.remove(); renderCategories(); render();
      });
    foot.appendChild(del);
  }
  const save = el("button", "btn btn--primary", existing ? "Save" : "Create");
  save.onclick = async () => {
    const name = m.querySelector("#f-name").value.trim();
    if (!name) return toast("Enter a category name", "danger");
    if (existing) await store.updateCategory(existing.id, { name, icon });
    else await store.addCategory({ name, icon });
    overlay.remove(); toast(existing ? "Category updated" : "Category created", "success");
  };
  m.querySelector(".modal-close").onclick = () => overlay.remove();
  foot.appendChild(save);
}

// ── Item (Option) modal ──────────────────────────────────────
function itemModal(existing) {
  const initialCat = existing?.categoryId || (state.activeCategoryId !== "all" ? state.activeCategoryId : "");
  const media = existing?.mediaType || "image";
  const m = modalShell(existing ? "Edit Option" : "Add Option", `
    <div class="form-group"><label class="form-label">Name</label>
      <input class="text-input" id="f-name" placeholder="e.g. Samsung 30Q 18650" value="${esc(existing?.name || "")}"></div>
    <div class="form-group"><label class="form-label">Info / notes</label>
      <textarea class="text-input" id="f-info" placeholder="Specs, where it's used…">${esc(existing?.info || "")}</textarea></div>
    <div class="form-group"><label class="form-label">Quantity in stock</label>
      <input class="text-input" id="f-qty" type="number" inputmode="numeric" min="0" value="${existing?.quantity ?? 1}"></div>
    <div class="form-group"><label class="form-label">Link (shopping / datasheet)</label>
      <input class="text-input" id="f-link" placeholder="https://…" value="${esc(existing?.link || "")}"></div>
    <div class="form-group"><label class="form-label">Card media</label>
      <div class="seg" id="f-media">
        <button type="button" class="seg-opt ${media === "image" ? "active" : ""}" data-media="image">Image</button>
        <button type="button" class="seg-opt ${media === "embed" ? "active" : ""}" data-media="embed">Embed link</button>
      </div></div>
    <div class="form-group" id="grp-image" ${media === "embed" ? "hidden" : ""}>
      <label class="form-label">Photo URL</label>
      <input class="text-input" id="f-photo" placeholder="https://… image link" value="${esc(existing?.photoUrl || "")}"></div>
    <div class="form-group" id="grp-embed" ${media === "image" ? "hidden" : ""}>
      <label class="form-label">Embed URL</label>
      <input class="text-input" id="f-embed" placeholder="defaults to the link above" value="${esc(existing?.embedUrl || "")}">
      <div class="form-hint">Embeds the page right on the card. Note: some shops block being embedded (they'll show blank — the ↗ button still opens them).</div></div>
    <div class="form-group"><label class="form-label">Category</label><div id="sel-cat"></div></div>
    <div class="form-group"><label class="form-label">Subcategory</label><div id="sel-sub"></div></div>
    <div class="form-group"><label class="form-label">Class</label><div id="sel-cls"></div></div>`, true);
  const overlay = openModal(m);

  // media toggle
  let mediaType = media;
  m.querySelectorAll("#f-media .seg-opt").forEach((b) => b.onclick = () => {
    m.querySelectorAll("#f-media .seg-opt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); mediaType = b.dataset.media;
    m.querySelector("#grp-image").hidden = mediaType !== "image";
    m.querySelector("#grp-embed").hidden = mediaType !== "embed";
  });

  // custom dropdowns
  const noneOpt = { value: "", label: "— none —" };
  const subOpts = (catId) => [noneOpt, ...state.subcategories.filter((s) => s.categoryId === catId).map((s) => ({ value: s.id, label: s.name }))];
  const catSel = makeSelect(
    [noneOpt, ...state.categories.map((c) => ({ value: c.id, label: c.name }))],
    initialCat, (v) => subSel.setOptions(subOpts(v)), "— none —");
  const subSel = makeSelect(subOpts(initialCat), existing?.subcategoryId || "", null, "— none —");
  const clsSel = makeSelect(
    [noneOpt, ...state.classes.map((c) => ({ value: c.id, label: c.name }))],
    existing?.classId || (state.activeClassId !== "all" ? state.activeClassId : ""), null, "— none —");
  m.querySelector("#sel-cat").appendChild(catSel);
  m.querySelector("#sel-sub").appendChild(subSel);
  m.querySelector("#sel-cls").appendChild(clsSel);

  const foot = m.querySelector(".modal-foot");
  if (existing) {
    const del = el("button", "btn btn--danger", `<i class="fa-solid fa-trash"></i> Delete`);
    del.onclick = () => confirmDelete(`Delete “${existing.name}”?`, async () => { await store.deleteItem(existing.id); overlay.remove(); });
    foot.appendChild(del);
  }
  const save = el("button", "btn btn--primary", existing ? "Save" : "Add");
  save.onclick = async () => {
    const data = {
      name:  m.querySelector("#f-name").value.trim(),
      info:  m.querySelector("#f-info").value.trim(),
      quantity: Math.max(0, parseInt(m.querySelector("#f-qty").value, 10) || 0),
      link:  m.querySelector("#f-link").value.trim(),
      mediaType,
      photoUrl: m.querySelector("#f-photo").value.trim(),
      embedUrl: m.querySelector("#f-embed").value.trim(),
      categoryId:    catSel.getValue() || null,
      subcategoryId: subSel.getValue() || null,
      classId:       clsSel.getValue() || null,
    };
    if (!data.name) return toast("Enter a name", "danger");
    if (existing) await store.updateItem(existing.id, data);
    else await store.addItem({ ...data, groupIds: existing?.groupIds || [] });
    overlay.remove(); toast(existing ? "Saved" : "Option added", "success");
  };
  m.querySelector(".modal-close").onclick = () => overlay.remove();
  foot.appendChild(save);
}

// ── Confirm delete ───────────────────────────────────────────
function confirmDelete(msg, onYes) {
  const m = modalShell("Confirm", `<p style="font-size:0.85rem;line-height:1.6;color:var(--text-2)">${esc(msg)}</p>`);
  const overlay = openModal(m);
  const foot = m.querySelector(".modal-foot");
  const no = el("button", "btn btn--ghost", "Cancel"); no.onclick = () => overlay.remove();
  const yes = el("button", "btn btn--danger", "Delete");
  yes.onclick = async () => { await onYes(); overlay.remove(); toast("Deleted", "success"); };
  m.querySelector(".modal-close").onclick = () => overlay.remove();
  foot.append(no, yes);
}

// ── Settings modal ───────────────────────────────────────────
$("#settings-btn").onclick = () => settingsModal();

// ── Passphrase / key-encryption helpers ──────────────────────
function promptPassphrase(title, confirm) {
  return new Promise((resolve) => {
    const m = modalShell(title, `
      <div class="form-group"><label class="form-label">Passphrase</label>
        <input class="text-input" id="pp1" type="password" autocomplete="off"></div>
      ${confirm ? `<div class="form-group"><label class="form-label">Confirm passphrase</label>
        <input class="text-input" id="pp2" type="password" autocomplete="off"></div>` : ""}
      <p class="form-hint">Never stored anywhere. You re-enter it once per device/session to use ARIA. If you forget it, just re-enter your API keys.</p>`);
    const overlay = openModal(m);
    const done = (v) => { overlay.remove(); resolve(v); };
    const foot = m.querySelector(".modal-foot");
    const cancel = el("button", "btn btn--ghost", "Cancel"); cancel.onclick = () => done(null);
    const ok = el("button", "btn btn--primary", confirm ? "Set passphrase" : "Unlock");
    ok.onclick = () => {
      const a = m.querySelector("#pp1").value;
      if (!a) return toast("Enter a passphrase", "danger");
      if (confirm && a !== m.querySelector("#pp2").value) return toast("Passphrases don't match", "danger");
      done(a);
    };
    m.querySelector(".modal-close").onclick = () => done(null);
    foot.append(cancel, ok);
  });
}

// Decrypt every stored key blob with the passphrase (throws if wrong).
async function unlockKeys(pass) {
  const out = {};
  for (const [pid, val] of Object.entries(state.settings.apiKeys || {})) {
    if (isEncrypted(val)) out[pid] = await decryptString(val, pass);
    else if (typeof val === "string") out[pid] = val;
  }
  return out;
}

// Returns settings with PLAINTEXT keys ready for ARIA. Prompts to unlock if needed.
async function ensureUnlocked() {
  if (!state.settings.encrypted) return state.settings;
  if (!state.unlocked) {
    const pass = await promptPassphrase("Unlock API keys", false);
    if (!pass) throw new Error("Passphrase required to unlock your API key.");
    try { state.decryptedKeys = await unlockKeys(pass); }
    catch { throw new Error("Wrong passphrase — couldn't unlock your keys."); }
    state.keyPass = pass; state.unlocked = true;
  }
  return { ...state.settings, apiKeys: state.decryptedKeys };
}

function settingsModal() {
  const s = state.settings;
  let prov = s.aiProvider || "anthropic";
  let searchProv = s.searchProvider || "none";
  let theme = s.theme || "dark";
  let encState = !!s.encrypted;
  const models = { ...(s.models || {}) };
  // plaintext keys the user is editing (blobs are only revealed after Unlock)
  let editKeys = encState ? { ...state.decryptedKeys } : { ...(s.apiKeys || {}) };
  const keyPlaceholder = (pid) =>
    (encState && !editKeys[pid] && isEncrypted(s.apiKeys?.[pid]))
      ? "•••• encrypted — Unlock to edit, or type a new key" : "Paste your API key";

  const m = modalShell("Settings", `
    <div class="settings-section">
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div><div class="settings-label">AI provider</div>
          <div class="settings-hint">ARIA uses this provider. Pick one and paste its API key below.</div></div>
        <div id="sel-provider"></div>
      </div>
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="settings-label">API key — <span id="prov-label">${PROVIDERS[prov].label}</span></div>
        <input class="text-input" id="f-key" type="password" placeholder="${keyPlaceholder(prov)}" value="${esc(editKeys[prov] || "")}">
        <input class="text-input" id="f-model" placeholder="Model (default: ${PROVIDERS[prov].defaultModel})" value="${esc(models[prov] || "")}">
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-row">
        <div><div class="settings-label">Encrypt API keys</div>
          <div class="settings-hint">Zero-knowledge AES-GCM. Keys become unreadable in the database without your passphrase — entered once per device/session.</div></div>
        <div class="seg" id="f-enc">
          <button class="seg-opt ${encState ? "" : "active"}" data-enc="off">Off</button>
          <button class="seg-opt ${encState ? "active" : ""}" data-enc="on">On</button>
        </div>
      </div>
      <div class="settings-row" id="enc-pass-row" ${encState ? "" : "hidden"} style="flex-direction:column;align-items:stretch;gap:8px">
        <div class="settings-label">Passphrase</div>
        <input class="text-input" id="f-pass" type="password" autocomplete="off" placeholder="${s.encrypted ? "Re-enter to save key changes" : "Choose a passphrase"}">
        <button class="btn btn--ghost btn--sm" id="unlock-btn" ${s.encrypted && !state.unlocked ? "" : "hidden"}><i class="fa-solid fa-lock-open"></i> Unlock to edit keys</button>
      </div>
      <div class="settings-row"><div class="key-warn" style="width:100%"><i class="fa-solid fa-triangle-exclamation"></i> <span id="enc-note"></span></div></div>
    </div>

    <div class="settings-section">
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:8px">
        <div><div class="settings-label">Web search (optional)</div>
          <div class="settings-hint">Let ARIA pull live results — current parts, prices, datasheets — before it answers. <a href="https://tavily.com" target="_blank" rel="noopener">Tavily</a> has a free tier.</div></div>
        <div id="sel-search"></div>
        <input class="text-input" id="f-search-key" type="password" placeholder="Tavily API key (tvly-…)" ${searchProv === "none" ? "hidden" : ""} value="${esc(editKeys.tavily || "")}">
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-row">
        <div><div class="settings-label">Theme</div><div class="settings-hint">Dark cyberpunk or light.</div></div>
        <div class="seg" id="f-theme">
          <button class="seg-opt ${theme === "dark" ? "active" : ""}" data-theme="dark">Dark</button>
          <button class="seg-opt ${theme === "light" ? "active" : ""}" data-theme="light">Light</button>
        </div>
      </div>
    </div>

    <div class="settings-section">
      <div class="settings-row" style="flex-direction:column;align-items:stretch;gap:10px">
        <div><div class="settings-label">Inventory export</div>
          <div class="settings-hint">Copy or download a snapshot of every item — names, quantities, categories, subcategories, groups and links. Paste it into a chat with your AI assistant so it knows exactly what you have on hand.</div></div>
        <div style="display:flex;gap:8px;flex-wrap:wrap">
          <button class="btn btn--ghost" id="exp-copy"><i class="fa-solid fa-copy"></i> Copy for AI</button>
          <button class="btn btn--ghost" id="exp-md"><i class="fa-solid fa-clipboard-list"></i> Copy as text</button>
          <button class="btn btn--ghost" id="exp-dl"><i class="fa-solid fa-download"></i> Download JSON</button>
        </div>
      </div>
    </div>`, true);
  const overlay = openModal(m);

  const keyIn = m.querySelector("#f-key");
  const modelIn = m.querySelector("#f-model");
  const passRow = m.querySelector("#enc-pass-row");
  const passIn = m.querySelector("#f-pass");
  const unlockBtn = m.querySelector("#unlock-btn");
  const searchKeyIn = m.querySelector("#f-search-key");
  const encNote = m.querySelector("#enc-note");
  const setEncNote = () => {
    encNote.textContent = encState
      ? "Keys are encrypted with your passphrase — unreadable in the database without it."
      : "Keys are saved to your account (private via Firestore rules) but stored unencrypted. Turn this on for at-rest encryption.";
  };
  setEncNote();

  const provSel = makeSelect(
    Object.entries(PROVIDERS).map(([id, p]) => ({ value: id, label: p.label })),
    prov, (v) => {
      prov = v;
      m.querySelector("#prov-label").textContent = PROVIDERS[v].label;
      keyIn.value = editKeys[v] || "";
      keyIn.placeholder = keyPlaceholder(v);
      modelIn.value = models[v] || "";
      modelIn.placeholder = `Model (default: ${PROVIDERS[v].defaultModel})`;
    });
  m.querySelector("#sel-provider").appendChild(provSel);
  keyIn.oninput   = () => { editKeys[prov] = keyIn.value.trim(); };
  modelIn.oninput = () => { models[prov] = modelIn.value.trim(); };

  const searchSel = makeSelect(
    Object.entries(SEARCH_PROVIDERS).map(([id, p]) => ({ value: id, label: p.label })),
    searchProv, (v) => { searchProv = v; searchKeyIn.hidden = (v === "none"); });
  m.querySelector("#sel-search").appendChild(searchSel);
  searchKeyIn.oninput = () => { editKeys.tavily = searchKeyIn.value.trim(); };

  // encryption on/off toggle
  m.querySelectorAll("#f-enc .seg-opt").forEach((b) => b.onclick = () => {
    m.querySelectorAll("#f-enc .seg-opt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); encState = b.dataset.enc === "on";
    passRow.hidden = !encState;
    unlockBtn.hidden = !(encState && s.encrypted && !state.unlocked);
    keyIn.placeholder = keyPlaceholder(prov);
    setEncNote();
  });

  // unlock existing encrypted keys for editing
  unlockBtn.onclick = async () => {
    const pass = await promptPassphrase("Unlock API keys", false);
    if (!pass) return;
    try { state.decryptedKeys = await unlockKeys(pass); }
    catch { return toast("Wrong passphrase", "danger"); }
    state.keyPass = pass; state.unlocked = true;
    editKeys = { ...editKeys, ...state.decryptedKeys };
    keyIn.value = editKeys[prov] || ""; searchKeyIn.value = editKeys.tavily || "";
    passIn.value = pass; unlockBtn.hidden = true;
    toast("Keys unlocked", "success");
  };

  m.querySelectorAll("#f-theme .seg-opt").forEach((b) => b.onclick = () => {
    m.querySelectorAll("#f-theme .seg-opt").forEach((x) => x.classList.remove("active"));
    b.classList.add("active"); theme = b.dataset.theme;
    document.documentElement.setAttribute("data-theme", theme);
  });

  m.querySelector("#exp-copy").onclick = () => copyText(JSON.stringify(buildExportData(), null, 2), "Inventory JSON copied — paste it to your AI");
  m.querySelector("#exp-md").onclick   = () => copyText(buildExportText(), "Inventory copied as text");
  m.querySelector("#exp-dl").onclick   = () => downloadJson(buildExportData());

  const foot = m.querySelector(".modal-foot");
  const save = el("button", "btn btn--primary", "Save");
  save.onclick = async () => {
    editKeys[prov] = keyIn.value.trim();
    models[prov] = modelIn.value.trim();
    if (searchKeyIn.value.trim()) editKeys.tavily = searchKeyIn.value.trim();

    const outKeys = {};
    if (encState) {
      const pass = passIn.value || state.keyPass;
      if (!pass) { toast("Enter a passphrase to encrypt your keys", "danger"); return; }
      const ids = new Set([...Object.keys(editKeys), ...Object.keys(s.apiKeys || {})]);
      for (const pid of ids) {
        const plain = editKeys[pid];
        if (plain && plain.length) outKeys[pid] = await encryptString(plain, pass);
        else if (!state.unlocked && isEncrypted(s.apiKeys?.[pid])) outKeys[pid] = s.apiKeys[pid]; // keep un-retyped locked key
      }
      state.keyPass = pass; state.unlocked = true;
      state.decryptedKeys = Object.fromEntries(Object.entries(editKeys).filter(([, v]) => v && v.length));
    } else {
      if (s.encrypted && !state.unlocked) { toast("Unlock your keys first to turn encryption off", "danger"); return; }
      const ids = new Set([...Object.keys(editKeys), ...Object.keys(state.decryptedKeys || {})]);
      for (const pid of ids) {
        const plain = editKeys[pid] ?? state.decryptedKeys[pid];
        if (plain && plain.length) outKeys[pid] = plain;
      }
      state.decryptedKeys = {}; state.keyPass = null; state.unlocked = false;
    }

    const patch = { aiProvider: prov, apiKeys: outKeys, models, theme, searchProvider: searchProv, encrypted: encState };
    state.settings = { ...state.settings, ...patch };
    await store.saveSettings(patch);
    overlay.remove(); toast("Settings saved", "success");
  };
  m.querySelector(".modal-close").onclick = () => { document.documentElement.setAttribute("data-theme", state.settings.theme || "dark"); overlay.remove(); };
  foot.appendChild(save);
}

// ── Inventory export helpers ─────────────────────────────────
const nameById = (arr, id) => arr.find((x) => x.id === id)?.name || null;
function buildExportData() {
  return {
    app: "Forge Hardware Tracker",
    generatedAt: new Date().toISOString(),
    counts: { items: state.items.length, categories: state.categories.length, groups: state.groups.length, classes: state.classes.length },
    items: state.items.map((i) => ({
      name: i.name,
      quantity: i.quantity ?? 1,
      category: nameById(state.categories, i.categoryId),
      subcategory: nameById(state.subcategories, i.subcategoryId),
      class: nameById(state.classes, i.classId),
      groups: (i.groupIds || []).map((g) => nameById(state.groups, g)).filter(Boolean),
      info: i.info || "",
      link: i.link || "",
    })),
  };
}
function buildExportText() {
  const d = buildExportData();
  const lines = [`# Hardware inventory — ${d.items.length} items (generated ${d.generatedAt})`, ""];
  const byCat = {};
  d.items.forEach((it) => { (byCat[it.category || "Uncategorized"] ||= []).push(it); });
  Object.keys(byCat).sort().forEach((cat) => {
    lines.push(`## ${cat}`);
    byCat[cat].forEach((it) => {
      const bits = [`x${it.quantity}`];
      if (it.subcategory) bits.push(it.subcategory);
      if (it.class) bits.push(`class:${it.class}`);
      if (it.groups.length) bits.push(`groups:${it.groups.join("/")}`);
      let line = `- ${it.name} (${bits.join(", ")})`;
      if (it.info) line += ` — ${it.info}`;
      if (it.link) line += ` [${it.link}]`;
      lines.push(line);
    });
    lines.push("");
  });
  return lines.join("\n");
}
async function copyText(text, msg) {
  try { await navigator.clipboard.writeText(text); toast(msg, "success"); }
  catch {
    const ta = el("textarea"); ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0"; document.body.appendChild(ta); ta.select();
    try { document.execCommand("copy"); toast(msg, "success"); } catch { toast("Copy failed", "danger"); }
    ta.remove();
  }
}
function downloadJson(obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = el("a"); a.href = url; a.download = "forge-inventory.json"; a.click();
  URL.revokeObjectURL(url); toast("Downloaded forge-inventory.json", "success");
}

// ============================================================
//  ARIA panel
// ============================================================
const ariaPanel = $("#aria-panel");
$("#aria-toggle").onclick = () => toggleAria();
$("#aria-close").onclick = () => toggleAria(false);
function toggleAria(force) {
  state.aria.open = force ?? !state.aria.open;
  ariaPanel.hidden = !state.aria.open;
  $("#aria-toggle").classList.toggle("active", state.aria.open);
  if (state.aria.open) {
    renderAria();
    if (!state.aria.messages.length) renderSuggestions();
    $("#aria-input").focus();
    ariaPanel.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
}

function buildInventory() {
  return state.categories.map((c) => ({
    category: c.name,
    items: state.items.filter((i) => i.categoryId === c.id).map((i) => i.name),
  }));
}

function renderSuggestions() {
  const box = $("#aria-suggest");
  const ideas = [
    "What do I need to wire an 18650 pack to an ESP32?",
    "How do I safely charge a 21700 cell?",
    "What sensors pair well with a Raspberry Pi for a weather station?",
  ];
  box.innerHTML = "";
  ideas.forEach((t) => {
    const c = el("button", "aria-chip", `<i class="fa-solid fa-wand-magic-sparkles"></i> ${esc(t)}`);
    c.onclick = () => { $("#aria-input").value = t; sendAria(t); };
    box.appendChild(c);
  });
}

function renderAria() {
  const box = $("#aria-messages");
  box.innerHTML = "";
  if (!state.aria.messages.length) {
    box.appendChild(el("div", "aria-empty",
      `<i class="fa-solid fa-robot"></i><div>Ask ARIA what parts a build needs.<br>It knows what's in your inventory.</div>`));
    return;
  }
  $("#aria-suggest").innerHTML = "";
  state.aria.messages.forEach((msg) => {
    box.appendChild(el("div", "aria-msg " + (msg.role === "user" ? "user" : "bot"), esc(msg.content)));
  });
  box.scrollTop = box.scrollHeight;
}

$("#aria-form").onsubmit = (e) => { e.preventDefault(); const v = $("#aria-input").value.trim(); if (v) sendAria(v); };
$("#aria-new").onclick = () => { state.activeConvId = null; state.aria.messages = []; renderAria(); renderSuggestions(); $("#aria-history").hidden = true; };

async function sendAria(text) {
  if (state.aria.busy) return;
  $("#aria-input").value = "";
  state.aria.messages.push({ role: "user", content: text });
  renderAria();

  const box = $("#aria-messages");
  const thinking = el("div", "aria-msg bot thinking", "ARIA is thinking…");
  box.appendChild(thinking); box.scrollTop = box.scrollHeight;
  state.aria.busy = true; $("#aria-send").disabled = true;

  try {
    const eff = await ensureUnlocked();   // resolves plaintext keys if encryption is on
    const reply = await ask(eff, state.aria.messages, buildInventory());
    thinking.remove();
    state.aria.messages.push({ role: "assistant", content: reply });
    renderAria();
    await persistConversation(text);
  } catch (err) {
    thinking.remove();
    box.appendChild(el("div", "aria-msg err", esc(err.message || "Something went wrong.")));
    box.scrollTop = box.scrollHeight;
  } finally {
    state.aria.busy = false; $("#aria-send").disabled = false; $("#aria-input").focus();
  }
}

async function persistConversation(firstText) {
  try {
    if (!state.activeConvId) {
      const ref = await store.createConversation(firstText.slice(0, 40));
      state.activeConvId = ref.id;
    }
    await store.saveConversation(state.activeConvId, state.aria.messages);
  } catch (e) { console.error("persist conv", e); }
}

// history
$("#aria-history-btn").onclick = () => { const h = $("#aria-history"); h.hidden = !h.hidden; if (!h.hidden) renderHistory(); };
function renderHistory() {
  const h = $("#aria-history");
  if (h.hidden) return;
  h.innerHTML = "";
  if (!state.conversations.length) { h.appendChild(el("div", "aria-history-empty", "No saved chats yet.")); return; }
  state.conversations.forEach((c) => {
    const it = el("div", "aria-history-item",
      `<i class="fa-solid fa-message" style="color:var(--text-3);font-size:0.7rem"></i>
       <span class="title">${esc(c.title || "Chat")}</span>
       <button class="del"><i class="fa-solid fa-trash"></i></button>`);
    it.querySelector(".title").onclick = () => {
      state.activeConvId = c.id; state.aria.messages = c.messages || []; h.hidden = true; renderAria();
    };
    it.querySelector(".del").onclick = async (e) => {
      e.stopPropagation();
      await store.deleteConversation(c.id);
      if (state.activeConvId === c.id) { state.activeConvId = null; state.aria.messages = []; renderAria(); }
    };
    h.appendChild(it);
  });
}

// ── auth buttons ─────────────────────────────────────────────
$("#signin-btn").onclick = () => store.signIn().catch((e) => toast(e.message, "danger"));
$("#signout-btn").onclick = () => store.logOut();

// ── toast ────────────────────────────────────────────────────
function toast(msg, kind) {
  const t = el("div", "toast " + (kind || ""), esc(msg));
  $("#toast-container").appendChild(t);
  setTimeout(() => { t.style.opacity = "0"; setTimeout(() => t.remove(), 280); }, 2600);
}

// close class menu on outside click
document.addEventListener("click", (e) => {
  if (!e.target.closest("#class-switch") && !e.target.closest("#class-menu")) closeClassMenu();
});
