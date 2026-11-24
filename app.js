"use strict";
/* Eksoch Invoice Maker: invoices and quotations, stored on this device only.
   Pro is unlocked with a Gumroad membership license key, checked against Gumroad's license API,
   or for good with an AppSumo code, checked on this device against the hashes in pro-codes.js. */

// ---- Gumroad product (fill in once the membership product exists) ----
const GUMROAD = {
  productId: "",                                                  // Gumroad product ID (Product > Content > License key section)
  buyUrl: "https://eksochanalytics.gumroad.com/l/invoice-maker",  // where the "Get Pro" button goes
  manageUrl: "https://app.gumroad.com/library",                   // where buyers manage or cancel
};
const FREE_DOCS_PER_MONTH = 5;
const RECHECK_MS = 24 * 3600e3;      // re-verify the key with Gumroad once a day when online
const OFFLINE_GRACE_MS = 21 * 86400e3; // keep Pro working this long without reaching Gumroad

const KEY = "eksoch-invoice-maker-v1";
const params = new URLSearchParams(location.search);
const DEMO = params.has("demo");

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (v) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const num = (v) => { const n = parseFloat(String(v ?? "").replace(/,/g, "")); return Number.isFinite(n) ? n : 0; };
const round2 = (n) => Math.round((n + Number.EPSILON) * 100) / 100;
function toISO(d) { const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000); return z.toISOString().slice(0, 10); }
const today = () => toISO(new Date());
function addDays(iso, n) { const d = new Date((iso || today()) + "T00:00:00"); d.setDate(d.getDate() + Number(n || 0)); return toISO(d); }
function fmtDate(iso) {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}

const CURRENCIES = [
  ["INR", "Indian Rupee"], ["USD", "US Dollar"], ["EUR", "Euro"], ["GBP", "British Pound"], ["AED", "UAE Dirham"],
  ["SAR", "Saudi Riyal"], ["QAR", "Qatari Riyal"], ["AUD", "Australian Dollar"], ["CAD", "Canadian Dollar"],
  ["SGD", "Singapore Dollar"], ["MYR", "Malaysian Ringgit"], ["JPY", "Japanese Yen"], ["CHF", "Swiss Franc"],
  ["PKR", "Pakistani Rupee"], ["BDT", "Bangladeshi Taka"], ["NPR", "Nepalese Rupee"], ["LKR", "Sri Lankan Rupee"],
  ["ZAR", "South African Rand"], ["NGN", "Nigerian Naira"], ["KES", "Kenyan Shilling"], ["NZD", "New Zealand Dollar"],
];
const CUR_WORDS = {
  INR: ["Rupees", "Paise"], USD: ["US Dollars", "Cents"], EUR: ["Euros", "Cents"], GBP: ["Pounds", "Pence"],
  AED: ["Dirhams", "Fils"], SAR: ["Riyals", "Halalas"], QAR: ["Riyals", "Dirhams"], AUD: ["Australian Dollars", "Cents"],
  CAD: ["Canadian Dollars", "Cents"], SGD: ["Singapore Dollars", "Cents"], MYR: ["Ringgit", "Sen"], JPY: ["Yen", ""],
  CHF: ["Swiss Francs", "Rappen"], PKR: ["Rupees", "Paisa"], BDT: ["Taka", "Poisha"], NPR: ["Rupees", "Paisa"],
  LKR: ["Rupees", "Cents"], ZAR: ["Rand", "Cents"], NGN: ["Naira", "Kobo"], KES: ["Shillings", "Cents"], NZD: ["NZ Dollars", "Cents"],
};
const TEMPLATES = [["classic", "Classic"], ["modern", "Modern"], ["minimal", "Minimal"], ["elegant", "Elegant"]];
const INV_STATUS = ["draft", "sent", "paid", "cancelled"];
const QUO_STATUS = ["draft", "sent", "accepted", "declined", "invoiced"];

// ---------------- state ----------------
function defaults() {
  return {
    profile: { name: "", tagline: "", address: "", email: "", phone: "", website: "", taxId: "", logo: "", signature: "", payment: "" },
    settings: {
      currency: "INR", taxLabel: "GST", taxRate: 18, dueDays: 15, validDays: 30,
      invPrefix: "INV-", quoPrefix: "QUO-", nextInv: 1, nextQuo: 1,
      template: "classic", accent: "#1f6f78", amountInWords: true,
      notes: "Thank you for your business!", terms: "Payment is due within 15 days.",
      quoteTerms: "This quotation is valid for 30 days. Prices include all materials and labour unless stated.",
    },
    license: { key: "", status: "none", email: "", checkedAt: 0, recurrence: "", cancelled: false },
    clients: [],
    docs: [],
  };
}
function merge(s) {
  const d = defaults();
  return {
    profile: { ...d.profile, ...(s.profile || {}) },
    settings: { ...d.settings, ...(s.settings || {}) },
    license: { ...d.license, ...(s.license || {}) },
    clients: Array.isArray(s.clients) ? s.clients : [],
    docs: Array.isArray(s.docs) ? s.docs : [],
  };
}
function load() {
  try { const raw = localStorage.getItem(KEY); if (raw) return merge(JSON.parse(raw)); } catch (e) { /* fall through */ }
  return defaults();
}
let state = null; // set at startup, once every helper is defined
let saveTimer = 0;
function save() {
  if (DEMO) return true;
  try { localStorage.setItem(KEY, JSON.stringify(state)); return true; }
  catch (e) { toast("Couldn't save: this device's storage is full. Try a smaller logo, or export a backup."); return false; }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(() => { if (save()) flagSaved(); }, 350); }
function flagSaved() { const f = $("#savedFlag"); if (f) f.textContent = DEMO ? "Demo: changes aren't kept" : "Saved on this device"; }

function getPath(o, p) { return p.split(".").reduce((a, k) => (a == null ? a : a[k]), o); }
function setPath(o, p, v) { const ks = p.split("."); const last = ks.pop(); const t = ks.reduce((a, k) => (a[k] ??= {}), o); t[last] = v; }

// ---------------- plan / license ----------------
function isPro() {
  if (DEMO) return true;
  const L = state.license;
  if (L.kind === "code") return L.status === "active"; // AppSumo codes never expire
  return L.status === "active" && Date.now() - (L.checkedAt || 0) < OFFLINE_GRACE_MS;
}

// AppSumo codes (made by make_appsumo_codes.js) look like EIM-XXXX-XXXX-XXXX.
const CODE_SALT = "eksoch-invoice-maker|";
const normCode = (c) => String(c || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
const looksLikeCode = (c) => /^EIM[A-Z0-9]{12}$/.test(normCode(c));
async function codeIsValid(code) {
  const n = normCode(code);
  if (!self.PRO_CODE_HASHES || !crypto?.subtle) return false;
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(CODE_SALT + n));
  const hex = [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 24);
  return self.PRO_CODE_HASHES.has(hex);
}
function monthKey() { return today().slice(0, 7); }
function docsThisMonth() { return state.docs.filter((d) => (d.createdAt || "").slice(0, 7) === monthKey()).length; }
function canCreate() { return isPro() || docsThisMonth() < FREE_DOCS_PER_MONTH; }
function effTemplate(doc) { return isPro() ? (doc.template || "classic") : "classic"; }
function effAccent(doc) { return isPro() ? (doc.accent || state.settings.accent) : "#1f6f78"; }

async function verifyLicense(key) {
  if (!GUMROAD.productId) return { ok: false, reason: "Pro subscriptions aren't on sale yet. Please check back soon." };
  const body = new URLSearchParams({ product_id: GUMROAD.productId, license_key: key.trim(), increment_uses_count: "false" });
  const res = await fetch("https://api.gumroad.com/v2/licenses/verify", { method: "POST", body });
  const data = await res.json().catch(() => ({}));
  if (!data.success) return { ok: false, reason: data.message || "That license key wasn't recognised." };
  const p = data.purchase || {};
  if (p.refunded || p.chargebacked || p.disputed) return { ok: false, reason: "This purchase was refunded, so Pro is off." };
  if (p.subscription_ended_at || p.subscription_failed_at) return { ok: false, reason: "This subscription has ended. Renew it on Gumroad to turn Pro back on." };
  return { ok: true, email: p.email || "", recurrence: p.recurrence || "", cancelled: !!p.subscription_cancelled_at };
}
async function activate(key) {
  if (looksLikeCode(key)) {
    if (!(await codeIsValid(key))) return { ok: false, reason: "That code isn't valid. Check it against your AppSumo purchase and try again." };
    state.license = { ...defaults().license, key: normCode(key), status: "active", kind: "code", checkedAt: Date.now() };
    save(); renderBadge();
    return { ok: true, code: true };
  }
  let r;
  try { r = await verifyLicense(key); }
  catch (e) { return { ok: false, reason: "Couldn't reach Gumroad. Check your internet connection and try again." }; }
  if (r.ok) state.license = { key: key.trim(), status: "active", email: r.email, checkedAt: Date.now(), recurrence: r.recurrence, cancelled: r.cancelled };
  save(); renderBadge();
  return r;
}
async function recheckLicense() {
  const L = state.license;
  if (L.kind === "code") {
    if (!DEMO && L.status === "active" && !(await codeIsValid(L.key).catch(() => true))) { L.status = "inactive"; save(); renderBadge(); route(); }
    return;
  }
  if (DEMO || !L.key || L.status !== "active" || Date.now() - L.checkedAt < RECHECK_MS || !navigator.onLine) return;
  try {
    const r = await verifyLicense(L.key);
    if (r.ok) Object.assign(L, { checkedAt: Date.now(), email: r.email, recurrence: r.recurrence, cancelled: r.cancelled });
    else { L.status = "inactive"; toast(r.reason); }
    save(); renderBadge(); route();
  } catch (e) { /* offline or Gumroad down: keep Pro until the grace period runs out */ }
}

// ---------------- money ----------------
function fmt(n, cur) {
  cur = cur || state.settings.currency;
  try { return new Intl.NumberFormat(cur === "INR" ? "en-IN" : "en-US", { style: "currency", currency: cur }).format(n || 0); }
  catch (e) { return cur + " " + (n || 0).toFixed(2); }
}
function totals(doc) {
  const lines = (doc.items || []).map((it) => ({ amt: num(it.qty) * num(it.rate), tax: num(it.tax) }));
  const subtotal = lines.reduce((s, l) => s + l.amt, 0);
  let discount = doc.discountType === "pct" ? subtotal * num(doc.discount) / 100 : num(doc.discount);
  discount = Math.min(Math.max(discount, 0), subtotal);
  const ratio = subtotal ? (subtotal - discount) / subtotal : 0;
  const taxes = {};
  lines.forEach((l) => { if (l.tax) taxes[l.tax] = (taxes[l.tax] || 0) + l.amt * ratio * l.tax / 100; });
  const taxTotal = Object.values(taxes).reduce((a, b) => a + b, 0);
  const shipping = num(doc.shipping);
  const total = round2(subtotal - discount + taxTotal + shipping);
  const paid = doc.type === "invoice" ? Math.min(num(doc.amountPaid), total) : 0;
  return { subtotal, discount, taxes, taxTotal, shipping, total, paid, due: round2(total - paid) };
}
function statusOf(doc) {
  if (doc.type !== "invoice" || doc.status !== "sent") return doc.status;
  if (doc.dueDate && doc.dueDate < today()) return "overdue";
  return num(doc.amountPaid) > 0 ? "partial" : "sent";
}
function sumBy(docs, f) {
  const m = {};
  docs.forEach((d) => { m[d.currency] = (m[d.currency] || 0) + f(d); });
  const e = Object.entries(m).filter(([, v]) => Math.abs(v) > 0.004);
  return e.length ? e.map(([c, v]) => fmt(v, c)).join(" + ") : fmt(0);
}

// ---------------- amount in words ----------------
const ONES = ["", "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven", "twelve",
  "thirteen", "fourteen", "fifteen", "sixteen", "seventeen", "eighteen", "nineteen"];
const TENS = ["", "", "twenty", "thirty", "forty", "fifty", "sixty", "seventy", "eighty", "ninety"];
const two = (n) => (n < 20 ? ONES[n] : TENS[Math.floor(n / 10)] + (n % 10 ? "-" + ONES[n % 10] : ""));
const three = (n) => { const h = Math.floor(n / 100), r = n % 100; return (h ? ONES[h] + " hundred" + (r ? " and " : "") : "") + (r ? two(r) : ""); };
function intWords(n, indian) {
  if (n === 0) return "zero";
  const parts = [];
  if (indian) {
    const cr = Math.floor(n / 1e7); n %= 1e7;
    const lk = Math.floor(n / 1e5); n %= 1e5;
    const th = Math.floor(n / 1e3); n %= 1e3;
    if (cr) parts.push(intWords(cr, true) + " crore");
    if (lk) parts.push(two(lk) + " lakh");
    if (th) parts.push(two(th) + " thousand");
    if (n) parts.push(three(n));
  } else {
    for (const [v, name] of [[1e12, "trillion"], [1e9, "billion"], [1e6, "million"], [1e3, "thousand"]]) {
      const q = Math.floor(n / v);
      if (q) { parts.push(intWords(q, false) + " " + name); n %= v; }
    }
    if (n) parts.push(three(n));
  }
  return parts.join(" ");
}
function amountWords(amount, cur) {
  const [major, minor] = CUR_WORDS[cur] || [cur, "cents"];
  const a = Math.abs(round2(amount)), i = Math.floor(a), f = Math.round((a - i) * 100);
  let s = intWords(i, ["INR", "NPR", "PKR", "BDT"].includes(cur));
  s = s.charAt(0).toUpperCase() + s.slice(1) + " " + major;
  if (f && minor) s += " and " + intWords(f, false) + " " + minor;
  return s + " only";
}

// ---------------- documents ----------------
const pad = (n) => String(n).padStart(4, "0");
function nextNumber(type) {
  const s = state.settings, isInv = type === "invoice";
  let n = Number(isInv ? s.nextInv : s.nextQuo) || 1;
  const prefix = isInv ? s.invPrefix : s.quoPrefix;
  while (state.docs.some((d) => d.type === type && d.number === prefix + pad(n))) n++;
  return { number: prefix + pad(n), n };
}
function blankClient() { return { name: "", email: "", phone: "", address: "", taxId: "" }; }
function newDoc(type, clientId) {
  const s = state.settings, isInv = type === "invoice";
  const c = state.clients.find((x) => x.id === clientId);
  const issue = today();
  return {
    id: uid(), type, number: nextNumber(type).number, status: "draft",
    clientId: c ? c.id : "", client: c ? pick(c) : blankClient(),
    issueDate: issue, dueDate: addDays(issue, isInv ? s.dueDays : s.validDays),
    currency: s.currency, template: s.template, accent: s.accent,
    items: [{ desc: "", qty: 1, rate: "", tax: s.taxRate }],
    discountType: "pct", discount: "", shipping: "", amountPaid: "",
    notes: s.notes, terms: isInv ? s.terms : s.quoteTerms, reference: "",
    createdAt: "", updatedAt: "", paidDate: "", _new: true,
  };
}
const pick = (c) => ({ name: c.name || "", email: c.email || "", phone: c.phone || "", address: c.address || "", taxId: c.taxId || "" });
function commitDoc(doc) {
  if (!doc._new) return;
  delete doc._new;
  const s = state.settings, gen = nextNumber(doc.type);
  if (doc.number === gen.number) { if (doc.type === "invoice") s.nextInv = gen.n + 1; else s.nextQuo = gen.n + 1; }
  doc.createdAt = new Date().toISOString();
  state.docs.push(doc);
  history.replaceState(null, "", "#/doc/" + doc.id);
  renderBadge();
}
function cloneAs(src, type) {
  const d = newDoc(type, "");
  Object.assign(d, {
    clientId: src.clientId, client: { ...src.client }, currency: src.currency, template: src.template, accent: src.accent,
    items: src.items.map((i) => ({ ...i })), discountType: src.discountType, discount: src.discount, shipping: src.shipping,
    notes: src.notes, reference: src.reference,
  });
  if (type === src.type) d.terms = src.terms;
  return d;
}

// ---------------- the paper ----------------
function paperHTML(doc) {
  const p = state.profile, s = state.settings, t = totals(doc), cur = doc.currency, isInv = doc.type === "invoice";
  const st = statusOf(doc);
  const bizLines = [p.address, [p.phone, p.email].filter(Boolean).join("  ·  "), p.website, p.taxId ? `${s.taxLabel || "Tax"} No: ${p.taxId}` : ""].filter(Boolean).join("\n");
  const cl = doc.client || {};
  const clLines = [cl.address, [cl.phone, cl.email].filter(Boolean).join("  ·  "), cl.taxId ? `${s.taxLabel || "Tax"} No: ${cl.taxId}` : ""].filter(Boolean).join("\n");
  const items = (doc.items || []).filter((i) => i.desc || num(i.rate) || num(i.qty) !== 1);
  const anyTax = items.some((i) => num(i.tax));
  const rows = items.map((it, k) => `<tr>
      <td class="idx">${k + 1}</td><td class="d">${esc(it.desc)}</td>
      <td class="r">${esc(num(it.qty))}</td><td class="r">${fmt(num(it.rate), cur)}</td>
      ${anyTax ? `<td class="r">${num(it.tax) ? esc(num(it.tax)) + "%" : "–"}</td>` : ""}
      <td class="r">${fmt(num(it.qty) * num(it.rate), cur)}</td></tr>`).join("")
    || `<tr><td></td><td class="d" style="color:#9aa5b1">Your items will appear here</td><td></td><td></td>${anyTax ? "<td></td>" : ""}<td></td></tr>`;
  const taxRows = Object.entries(t.taxes).sort((a, b) => a[0] - b[0])
    .map(([r, v]) => `<tr><td>${esc(s.taxLabel || "Tax")} ${esc(r)}%</td><td>${fmt(v, cur)}</td></tr>`).join("");
  const stamp = isInv && (st === "paid" || st === "overdue") ? `<div class="p-stamp ${st}">${st}</div>` : "";
  const meta = [
    [isInv ? "Invoice No" : "Quote No", doc.number],
    ["Date", fmtDate(doc.issueDate)],
    [isInv ? "Due date" : "Valid until", fmtDate(doc.dueDate)],
    doc.reference ? ["Reference", doc.reference] : null,
  ].filter(Boolean).map(([k, v]) => `<tr><td>${esc(k)}</td><td><b>${esc(v)}</b></td></tr>`).join("");
  const words = s.amountInWords && t.total > 0 ? `<b>Amount in words:</b><br>${esc(amountWords(t.total, cur))}` : "";
  const showPay = isInv && p.payment;
  return `<div class="paper t-${effTemplate(doc)}" style="--accent:${esc(effAccent(doc))}">
    <div class="p-head">
      <div class="p-biz">
        ${p.logo ? `<img class="p-logo" src="${p.logo}" alt="">` : ""}
        <div class="p-bizname">${esc(p.name || "Your Business Name")}</div>
        ${p.tagline ? `<div class="p-tag">${esc(p.tagline)}</div>` : ""}
        <div class="p-lines">${esc(bizLines || "Add your address and contact details in Settings")}</div>
      </div>
      <div class="p-title"><h1>${isInv ? "Invoice" : "Quotation"}</h1><table class="p-meta">${meta}</table>${stamp}</div>
    </div>
    <div class="p-parties">
      <div class="p-party"><div class="p-label">${isInv ? "Bill to" : "Prepared for"}</div>
        <div class="nm">${esc(cl.name || "Client name")}</div><div class="ln">${esc(clLines)}</div></div>
      ${doc.fromQuote ? `<div class="p-party"><div class="p-label">Against quotation</div><div class="ln">${esc(doc.fromQuote)}</div></div>` : ""}
    </div>
    <table class="p-items"><thead><tr><th class="idx">#</th><th>Description</th><th class="r">Qty</th><th class="r">Rate</th>${anyTax ? `<th class="r">${esc(s.taxLabel || "Tax")}</th>` : ""}<th class="r">Amount</th></tr></thead>
      <tbody>${rows}</tbody></table>
    <div class="p-sum">
      <div class="p-words">${words}</div>
      <table class="p-totals">
        <tr><td>Subtotal</td><td>${fmt(t.subtotal, cur)}</td></tr>
        ${t.discount ? `<tr><td>Discount${doc.discountType === "pct" ? ` (${esc(num(doc.discount))}%)` : ""}</td><td>− ${fmt(t.discount, cur)}</td></tr>` : ""}
        ${taxRows}
        ${t.shipping ? `<tr><td>Shipping</td><td>${fmt(t.shipping, cur)}</td></tr>` : ""}
        <tr class="grand"><td>Total</td><td>${fmt(t.total, cur)}</td></tr>
        ${isInv && t.paid ? `<tr><td>Paid</td><td>− ${fmt(t.paid, cur)}</td></tr><tr class="due"><td>Balance due</td><td>${fmt(t.due, cur)}</td></tr>` : ""}
      </table>
    </div>
    <div class="p-notes">
      ${showPay ? `<div><div class="p-label">Payment details</div><div class="txt">${esc(p.payment)}</div></div>` : ""}
      ${doc.terms ? `<div><div class="p-label">Terms &amp; conditions</div><div class="txt">${esc(doc.terms)}</div></div>` : ""}
    </div>
    <div class="p-foot">
      <div class="p-thanks">${esc(doc.notes || "")}</div>
      <div class="p-sign">${isPro() && p.signature ? `<img src="${p.signature}" alt="">` : `<div style="height:14mm"></div>`}
        <div class="bar">For ${esc(p.name || "Your Business")}<br>Authorised signatory</div></div>
    </div>
    ${isPro() ? "" : `<div class="p-brandline">Made with Eksoch Invoice Maker</div>`}
  </div>`;
}

// ---------------- shell ----------------
const view = $("#view");
let editing = null;
let toastTimer = 0;
function toast(msg) {
  const t = $("#toast"); t.textContent = msg; t.classList.add("show");
  clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove("show"), 3200);
}
function renderBadge() {
  const b = $("#planBadge");
  if (isPro()) b.innerHTML = `<b>Pro${DEMO ? " (demo)" : ""}</b><span class="muted">Unlimited documents</span>`;
  else b.innerHTML = `<b>Free plan</b><span class="muted">${docsThisMonth()} of ${FREE_DOCS_PER_MONTH} documents this month</span><br><a href="#/settings/pro">Upgrade to Pro</a>`;
}
function setNav(key) { $$(".nav a").forEach((a) => a.classList.toggle("active", a.dataset.nav === key)); }
function opts(list, cur) { return list.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(cur) ? " selected" : ""}>${esc(l)}</option>`).join(""); }
function pill(st) { return `<span class="pill ${esc(st)}">${esc(st)}</span>`; }
const lockTag = () => (isPro() ? "" : `<span class="lock">PRO</span>`);

function route() {
  const h = location.hash.replace(/^#\/?/, "");
  const [page, a, b] = h.split("/");
  editing = null;
  window.scrollTo(0, 0);
  if (page === "invoices") { setNav("invoices"); viewList("invoice"); }
  else if (page === "quotes") { setNav("quotes"); viewList("quote"); }
  else if (page === "clients") { setNav("clients"); viewClients(); }
  else if (page === "settings") { setNav("settings"); viewSettings(a); }
  else if (page === "new") {
    const type = a === "quote" ? "quote" : "invoice";
    setNav(type === "invoice" ? "invoices" : "quotes");
    if (!canCreate()) return viewLimit();
    viewEditor(newDoc(type, b));
  } else if (page === "doc") {
    const d = state.docs.find((x) => x.id === a);
    if (!d) { location.hash = "#/"; return; }
    setNav(d.type === "invoice" ? "invoices" : "quotes");
    viewEditor(d);
  } else { setNav("dash"); viewDash(); }
  view.focus({ preventScroll: true });
}

// ---------------- dashboard ----------------
function viewDash() {
  const inv = state.docs.filter((d) => d.type === "invoice");
  const quo = state.docs.filter((d) => d.type === "quote");
  const open = inv.filter((d) => ["sent", "partial", "overdue"].includes(statusOf(d)));
  const overdue = inv.filter((d) => statusOf(d) === "overdue");
  const paidMonth = inv.filter((d) => d.status === "paid" && (d.paidDate || "").slice(0, 7) === monthKey());
  const openQ = quo.filter((d) => ["draft", "sent"].includes(d.status));
  const recent = [...state.docs].sort((x, y) => (y.updatedAt || "").localeCompare(x.updatedAt || "")).slice(0, 8);
  const hello = state.profile.name ? `Welcome back, ${esc(state.profile.name)}` : "Dashboard";
  view.innerHTML = `
    <div class="page-head"><h1>${hello}</h1>
      <div class="actions"><a class="btn" href="#/new/quote">+ New quotation</a><a class="btn primary" href="#/new/invoice">+ New invoice</a></div></div>
    ${!state.profile.name && !DEMO ? `<div class="card upsell" style="margin-bottom:16px"><b>Start with your business details.</b>
      <span class="muted">Your name, address, logo and payment details appear on every invoice.</span>
      <a class="btn sm" style="margin-left:8px" href="#/settings">Open settings</a></div>` : ""}
    <div class="stats">
      <div class="stat"><div class="k">Outstanding</div><div class="v">${sumBy(open, (d) => totals(d).due)}</div><div class="s">${open.length} unpaid invoice${open.length === 1 ? "" : "s"}</div></div>
      <div class="stat"><div class="k">Overdue</div><div class="v" style="color:${overdue.length ? "var(--bad)" : "inherit"}">${sumBy(overdue, (d) => totals(d).due)}</div><div class="s">${overdue.length} past due date</div></div>
      <div class="stat"><div class="k">Paid this month</div><div class="v">${sumBy(paidMonth, (d) => totals(d).total)}</div><div class="s">${paidMonth.length} invoice${paidMonth.length === 1 ? "" : "s"}</div></div>
      <div class="stat"><div class="k">Open quotations</div><div class="v">${sumBy(openQ, (d) => totals(d).total)}</div><div class="s">${openQ.length} awaiting a decision</div></div>
    </div>
    <div class="card"><h2>Recent documents</h2>
      ${recent.length ? docTable(recent, true) : `<div class="empty"><h3>No invoices or quotations yet</h3>
        <p>Create your first invoice in under a minute, or load sample data to look around first.</p>
        <div class="actions" style="justify-content:center"><a class="btn primary" href="#/new/invoice">Create an invoice</a>
        <button class="btn" data-act="sample">Load sample data</button></div></div>`}
    </div>`;
  bindRows();
  const sb = $('[data-act="sample"]'); if (sb) sb.onclick = loadSample;
}
function docTable(docs, showType) {
  return `<table class="list"><thead><tr><th>Number</th><th>Client</th><th class="hide-sm">Date</th><th class="hide-sm">${showType ? "Due / valid" : docs[0]?.type === "quote" ? "Valid until" : "Due"}</th><th class="num">Amount</th><th>Status</th></tr></thead>
    <tbody>${docs.map((d) => `<tr class="row" data-id="${esc(d.id)}" tabindex="0">
      <td><b>${esc(d.number)}</b>${showType ? `<div class="muted small">${d.type === "invoice" ? "Invoice" : "Quotation"}</div>` : ""}</td>
      <td>${esc(d.client?.name || "—")}</td><td class="hide-sm">${fmtDate(d.issueDate)}</td><td class="hide-sm">${fmtDate(d.dueDate)}</td>
      <td class="num">${fmt(totals(d).total, d.currency)}</td><td>${pill(statusOf(d))}</td></tr>`).join("")}</tbody></table>`;
}
function bindRows() {
  $$("tr.row[data-id]").forEach((r) => {
    r.onclick = () => (location.hash = "#/doc/" + r.dataset.id);
    r.onkeydown = (e) => { if (e.key === "Enter") r.click(); };
  });
}

// ---------------- lists ----------------
function viewList(type) {
  const isInv = type === "invoice";
  const statuses = isInv ? [...INV_STATUS, "partial", "overdue"] : QUO_STATUS;
  view.innerHTML = `
    <div class="page-head"><h1>${isInv ? "Invoices" : "Quotations"}</h1>
      <div class="actions">${isInv ? `<button class="btn" data-act="csv">Export CSV ${lockTag()}</button>` : ""}
      <a class="btn primary" href="#/new/${type}">+ New ${isInv ? "invoice" : "quotation"}</a></div></div>
    <div class="card">
      <div class="toolbar"><input id="q" type="search" placeholder="Search number, client or item…" aria-label="Search">
        <select id="st" aria-label="Filter by status"><option value="">All statuses</option>${statuses.map((s) => `<option value="${s}">${s[0].toUpperCase() + s.slice(1)}</option>`).join("")}</select></div>
      <div id="listBody"></div></div>`;
  const draw = () => {
    const q = $("#q").value.trim().toLowerCase(), st = $("#st").value;
    const docs = state.docs.filter((d) => d.type === type)
      .filter((d) => !st || statusOf(d) === st)
      .filter((d) => !q || [d.number, d.client?.name, d.client?.email, d.reference, ...(d.items || []).map((i) => i.desc)].join(" ").toLowerCase().includes(q))
      .sort((a, b) => (b.issueDate + b.number).localeCompare(a.issueDate + a.number));
    $("#listBody").innerHTML = docs.length ? docTable(docs, false)
      : `<div class="empty"><h3>${state.docs.some((d) => d.type === type) ? "Nothing matches" : `No ${isInv ? "invoices" : "quotations"} yet`}</h3>
         <p>${q || st ? "Try a different search or status." : `Your ${isInv ? "invoices" : "quotations"} will be listed here.`}</p></div>`;
    bindRows();
  };
  $("#q").oninput = draw; $("#st").onchange = draw;
  const csv = $('[data-act="csv"]'); if (csv) csv.onclick = exportCSV;
  draw();
}

// ---------------- editor ----------------
function viewEditor(doc) {
  editing = doc;
  const isInv = doc.type === "invoice", s = state.settings;
  const statuses = (isInv ? INV_STATUS : QUO_STATUS).map((x) => [x, x[0].toUpperCase() + x.slice(1)]);
  const label = isInv ? "invoice" : "quotation";
  view.innerHTML = `
    <div class="page-head">
      <div><a href="#/${isInv ? "invoices" : "quotes"}" class="muted small">← All ${label}s</a>
        <h1>${doc._new ? "New " + label : esc(doc.number)} ${doc._new ? "" : pill(statusOf(doc))}</h1>
        <span class="saved-flag" id="savedFlag">${doc._new ? "Starts saving when you type" : DEMO ? "Demo: changes aren't kept" : "Saved on this device"}</span></div>
      <div class="actions">
        <button class="btn primary" data-act="print">⤓ Download PDF / Print</button>
        <button class="btn" data-act="email">✉ Email</button>
        ${isInv ? `<button class="btn" data-act="paid">✓ Mark paid</button>` : `<button class="btn" data-act="convert">→ Convert to invoice</button>`}
        <button class="btn" data-act="dup">Duplicate</button>
        <button class="btn danger" data-act="del">Delete</button>
      </div>
    </div>
    <div class="tabs"><button class="btn on" data-tab="edit">Edit</button><button class="btn" data-tab="preview">Preview</button></div>
    <div class="editor" data-tab="edit">
      <form class="form" id="docForm" autocomplete="off" onsubmit="return false">
        <div class="card"><h2>Details</h2>
          <div class="grid g3">
            <div><label for="f-number">${isInv ? "Invoice" : "Quote"} number</label><input id="f-number" data-f="number" value="${esc(doc.number)}"></div>
            <div><label for="f-issue">Date</label><input id="f-issue" type="date" data-f="issueDate" value="${esc(doc.issueDate)}"></div>
            <div><label for="f-due">${isInv ? "Due date" : "Valid until"}</label><input id="f-due" type="date" data-f="dueDate" value="${esc(doc.dueDate)}"></div>
            <div><label for="f-status">Status</label><select id="f-status" data-f="status">${opts(statuses, doc.status)}</select></div>
            <div><label for="f-cur">Currency</label><select id="f-cur" data-f="currency">${opts(CURRENCIES.map(([c, n]) => [c, c + " – " + n]), doc.currency)}</select></div>
            <div><label for="f-ref">Reference / PO</label><input id="f-ref" data-f="reference" value="${esc(doc.reference)}" placeholder="Optional"></div>
          </div></div>
        <div class="card"><div class="page-head" style="margin:0 0 8px"><h2 style="margin:0">${isInv ? "Bill to" : "Prepared for"}</h2>
          <div class="actions">${state.clients.length ? `<select id="clientPick" aria-label="Choose a saved client" style="width:auto"><option value="">Choose saved client…</option>${opts(state.clients.map((c) => [c.id, c.name]), doc.clientId)}</select>` : ""}
          <button class="btn sm" data-act="saveClient" type="button">Save client</button></div></div>
          <div class="grid g2">
            <div><label for="c-name">Client name</label><input id="c-name" data-f="client.name" value="${esc(doc.client.name)}" placeholder="Person or company"></div>
            <div><label for="c-email">Email</label><input id="c-email" type="email" data-f="client.email" value="${esc(doc.client.email)}"></div>
            <div><label for="c-phone">Phone</label><input id="c-phone" data-f="client.phone" value="${esc(doc.client.phone)}"></div>
            <div><label for="c-tax">${esc(s.taxLabel || "Tax")} number</label><input id="c-tax" data-f="client.taxId" value="${esc(doc.client.taxId)}" placeholder="Optional"></div>
            <div class="span2"><label for="c-addr">Address</label><textarea id="c-addr" data-f="client.address" rows="2">${esc(doc.client.address)}</textarea></div>
          </div></div>
        <div class="card"><h2>Items</h2>
          <table class="items"><thead><tr><th>Description</th><th class="c-qty">Qty</th><th class="c-rate">Rate</th><th class="c-tax">${esc(s.taxLabel || "Tax")} %</th><th class="c-amt" style="text-align:right">Amount</th><th class="c-x"></th></tr></thead>
            <tbody id="itemRows"></tbody></table>
          <button class="btn sm" type="button" data-act="addItem" style="margin-top:8px">+ Add item</button>
          <div class="grid g4" style="margin-top:14px">
            <div><label for="f-dtype">Discount type</label><select id="f-dtype" data-f="discountType">${opts([["pct", "Percent %"], ["amt", "Fixed amount"]], doc.discountType)}</select></div>
            <div><label for="f-disc">Discount</label><input id="f-disc" type="number" min="0" step="any" data-f="discount" value="${esc(doc.discount)}" placeholder="0"></div>
            <div><label for="f-ship">Shipping / other</label><input id="f-ship" type="number" step="any" data-f="shipping" value="${esc(doc.shipping)}" placeholder="0"></div>
            ${isInv ? `<div><label for="f-paid">Amount paid</label><input id="f-paid" type="number" min="0" step="any" data-f="amountPaid" value="${esc(doc.amountPaid)}" placeholder="0"></div>` : "<div></div>"}
          </div>
          <div class="totals-mini" id="miniTotals"></div></div>
        <div class="card"><h2>Notes &amp; look</h2>
          <div class="grid g2">
            <div><label for="f-notes">Note to client</label><textarea id="f-notes" data-f="notes" rows="2">${esc(doc.notes)}</textarea></div>
            <div><label for="f-terms">Terms &amp; conditions</label><textarea id="f-terms" data-f="terms" rows="2">${esc(doc.terms)}</textarea></div>
            <div><label for="f-tpl">Template ${lockTag()}</label><select id="f-tpl" data-f="template">${opts(TEMPLATES, effTemplate(doc))}</select></div>
            <div><label for="f-acc">Accent colour ${lockTag()}</label><input id="f-acc" type="color" data-f="accent" value="${esc(effAccent(doc))}"></div>
          </div></div>
      </form>
      <div class="preview-pane"><div class="preview-scroll"><div class="paper-wrap" id="paperWrap"></div></div></div>
    </div>`;
  renderItems();
  updatePreview();
  bindEditor();
}
function renderItems() {
  const d = editing, s = state.settings;
  $("#itemRows").innerHTML = d.items.map((it, i) => `<tr data-row="${i}">
    <td class="c-desc"><textarea data-i="${i}" data-k="desc" rows="1" aria-label="Item ${i + 1} description" placeholder="Item or service">${esc(it.desc)}</textarea></td>
    <td class="c-qty"><input type="number" step="any" data-i="${i}" data-k="qty" value="${esc(it.qty)}" aria-label="Quantity" placeholder="Qty"></td>
    <td class="c-rate"><input type="number" step="any" data-i="${i}" data-k="rate" value="${esc(it.rate)}" aria-label="Rate" placeholder="Rate"></td>
    <td class="c-tax"><input type="number" step="any" min="0" data-i="${i}" data-k="tax" value="${esc(it.tax)}" aria-label="${esc(s.taxLabel || "Tax")} percent" placeholder="%"></td>
    <td class="amt c-amt" data-amt="${i}">${fmt(num(it.qty) * num(it.rate), d.currency)}</td>
    <td class="c-x"><button type="button" class="x" data-del="${i}" aria-label="Remove item ${i + 1}">×</button></td></tr>`).join("");
  $$("#itemRows textarea").forEach(grow);
}
function grow(t) { t.style.height = "auto"; t.style.height = Math.max(38, t.scrollHeight + 2) + "px"; }
function updatePreview() {
  const d = editing; if (!d) return;
  const t = totals(d);
  $("#miniTotals").innerHTML = `<span class="muted">Subtotal ${fmt(t.subtotal, d.currency)}</span><span>Total ${fmt(t.total, d.currency)}</span>${d.type === "invoice" && t.paid ? `<span>Due ${fmt(t.due, d.currency)}</span>` : ""}`;
  $("#paperWrap").innerHTML = paperHTML(d);
  fitPreview();
}
function fitPreview() {
  const wrap = $("#paperWrap"); if (!wrap || !wrap.firstElementChild) return;
  const paper = wrap.firstElementChild, avail = wrap.parentElement.clientWidth - 32;
  if (avail <= 0) return;
  const s = Math.min(1, avail / paper.offsetWidth);
  paper.style.transform = `scale(${s})`;
  wrap.style.width = paper.offsetWidth * s + "px";
  wrap.style.height = paper.offsetHeight * s + "px";
}
function touched() {
  const d = editing;
  if (d._new) { commitDoc(d); const f = $("#savedFlag"); if (f) f.textContent = "Saving…"; }
  d.updatedAt = new Date().toISOString();
  saveSoon();
}
function bindEditor() {
  const d = editing, form = $("#docForm");
  form.addEventListener("input", (e) => {
    const el = e.target;
    if (el.dataset.k) {
      const i = Number(el.dataset.i);
      d.items[i][el.dataset.k] = el.value;
      if (el.tagName === "TEXTAREA") grow(el);
      const cell = $(`[data-amt="${i}"]`);
      if (cell) cell.textContent = fmt(num(d.items[i].qty) * num(d.items[i].rate), d.currency);
    } else if (el.dataset.f) {
      const f = el.dataset.f;
      if ((f === "template" || f === "accent") && !isPro()) {
        el.value = f === "template" ? "classic" : effAccent(d);
        toast("Templates and colours are part of Pro.");
        return;
      }
      setPath(d, f, el.value);
      if (f === "currency") renderItems();
      if (f === "issueDate" && el.value) {
        const days = d.type === "invoice" ? state.settings.dueDays : state.settings.validDays;
        if (!d.dueDate || d.dueDate < el.value) { d.dueDate = addDays(el.value, days); $("#f-due").value = d.dueDate; }
      }
      if (f === "status" && el.value === "paid") { d.paidDate = d.paidDate || today(); d.amountPaid = String(totals(d).total); const p = $("#f-paid"); if (p) p.value = d.amountPaid; }
    } else return;
    touched();
    updatePreview();
  });
  form.addEventListener("click", (e) => {
    const del = e.target.closest("[data-del]");
    if (del) {
      d.items.splice(Number(del.dataset.del), 1);
      if (!d.items.length) d.items.push({ desc: "", qty: 1, rate: "", tax: state.settings.taxRate });
      renderItems(); touched(); updatePreview();
    }
  });
  $('[data-act="addItem"]').onclick = () => {
    d.items.push({ desc: "", qty: 1, rate: "", tax: state.settings.taxRate });
    renderItems(); updatePreview();
    $(`[data-i="${d.items.length - 1}"][data-k="desc"]`).focus();
  };
  const cp = $("#clientPick");
  if (cp) cp.onchange = () => {
    const c = state.clients.find((x) => x.id === cp.value); if (!c) return;
    d.clientId = c.id; d.client = pick(c);
    ["name", "email", "phone", "taxId", "address"].forEach((k) => { $(`[data-f="client.${k}"]`).value = d.client[k]; });
    touched(); updatePreview();
  };
  $('[data-act="saveClient"]').onclick = () => {
    if (!d.client.name.trim()) return toast("Add the client's name first.");
    let c = state.clients.find((x) => x.id === d.clientId) || state.clients.find((x) => x.name.trim().toLowerCase() === d.client.name.trim().toLowerCase());
    if (c) Object.assign(c, pick(d.client)); else { c = { id: uid(), ...pick(d.client) }; state.clients.push(c); }
    d.clientId = c.id; touched(); toast(`Saved ${c.name} to your clients.`);
  };
  $('[data-act="print"]').onclick = () => printDoc(d);
  $('[data-act="email"]').onclick = () => emailDoc(d);
  $('[data-act="dup"]').onclick = () => {
    if (!canCreate()) return viewLimit();
    const c = cloneAs(d, d.type); viewEditor(c); history.replaceState(null, "", "#/new/" + d.type); toast("Copy ready. Edit it and it saves automatically.");
  };
  $('[data-act="del"]').onclick = () => {
    if (d._new) { location.hash = "#/" + (d.type === "invoice" ? "invoices" : "quotes"); return; }
    if (!confirm(`Delete ${d.number}? This can't be undone.`)) return;
    state.docs = state.docs.filter((x) => x.id !== d.id); save(); renderBadge();
    toast(`${d.number} deleted.`); location.hash = "#/" + (d.type === "invoice" ? "invoices" : "quotes");
  };
  const paid = $('[data-act="paid"]');
  if (paid) paid.onclick = () => {
    d.status = "paid"; d.paidDate = today(); d.amountPaid = String(totals(d).total);
    touched(); save(); toast(`${d.number} marked as paid.`); viewEditor(d);
  };
  const conv = $('[data-act="convert"]');
  if (conv) conv.onclick = () => {
    if (!canCreate()) return viewLimit();
    if (d._new) commitDoc(d);
    const inv = cloneAs(d, "invoice"); inv.fromQuote = d.number;
    d.status = "invoiced"; d.updatedAt = new Date().toISOString();
    commitDoc(inv); inv.updatedAt = new Date().toISOString(); save();
    toast(`Invoice ${inv.number} created from ${d.number}.`); viewEditor(inv);
  };
  $$(".tabs button").forEach((b) => b.onclick = () => {
    $(".editor").dataset.tab = b.dataset.tab;
    $$(".tabs button").forEach((x) => x.classList.toggle("on", x === b));
    fitPreview();
  });
}
function printDoc(doc) {
  $("#print-root").innerHTML = paperHTML(doc);
  const old = document.title;
  document.title = [doc.number, doc.client?.name].filter(Boolean).join(" - ");
  const restore = () => { document.title = old; window.removeEventListener("afterprint", restore); };
  window.addEventListener("afterprint", restore);
  setTimeout(() => window.print(), 50);
  toast('Choose "Save as PDF" as the printer to get a PDF file.');
}
function emailDoc(doc) {
  const t = totals(doc), isInv = doc.type === "invoice", p = state.profile;
  const kind = isInv ? "invoice" : "quotation";
  const subject = `${isInv ? "Invoice" : "Quotation"} ${doc.number}${p.name ? " from " + p.name : ""}`;
  const body = [
    `Hi ${doc.client?.name || "there"},`, "",
    isInv ? `Please find attached invoice ${doc.number} for ${fmt(t.due, doc.currency)}, due on ${fmtDate(doc.dueDate)}.`
      : `Please find attached quotation ${doc.number} for ${fmt(t.total, doc.currency)}, valid until ${fmtDate(doc.dueDate)}.`,
    isInv && p.payment ? "\nPayment details:\n" + p.payment : "", "",
    "Thank you,", p.name || "",
  ].join("\n");
  location.href = `mailto:${encodeURIComponent(doc.client?.email || "")}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  toast(`Your email app is opening. Attach the PDF of this ${kind} before sending.`);
  if (doc.status === "draft" && !doc._new) { doc.status = "sent"; doc.updatedAt = new Date().toISOString(); save(); }
}

// ---------------- limit reached ----------------
function viewLimit() {
  editing = null;
  view.innerHTML = `<div class="card upsell" style="max-width:640px">
    <h1>You've used this month's ${FREE_DOCS_PER_MONTH} free documents</h1>
    <p>The free plan makes ${FREE_DOCS_PER_MONTH} invoices or quotations a month. Your existing documents are all still here: open, edit, print and email them any time. More free documents unlock on the 1st.</p>
    ${proPitch()}
  </div>`;
}
function proPitch() {
  return `<h3>Eksoch Invoice Maker Pro</h3>
    <ul class="pro-list"><li>Unlimited invoices and quotations</li><li>All 4 templates and your own brand colour</li>
    <li>Your signature on every document</li><li>No "Made with" line on your PDFs</li><li>CSV export for your accountant</li></ul>
    <div class="actions">${GUMROAD.productId ? `<a class="btn primary" href="${esc(GUMROAD.buyUrl)}" target="_blank" rel="noopener">Get Pro on Gumroad</a>` : ""}
    <a class="btn ${GUMROAD.productId ? "" : "primary"}" href="#/settings/pro">I have a code or license key</a></div>`;
}

// ---------------- clients ----------------
function viewClients(editId) {
  const c = state.clients.find((x) => x.id === editId) || { id: "", ...blankClient() };
  const s = state.settings;
  const rows = [...state.clients].sort((a, b) => a.name.localeCompare(b.name)).map((cl) => {
    const docs = state.docs.filter((d) => d.clientId === cl.id && d.type === "invoice");
    const owed = docs.filter((d) => ["sent", "partial", "overdue"].includes(statusOf(d)));
    return `<tr><td><b>${esc(cl.name)}</b><div class="muted small">${esc([cl.email, cl.phone].filter(Boolean).join(" · "))}</div></td>
      <td class="hide-sm">${docs.length} invoice${docs.length === 1 ? "" : "s"}</td>
      <td class="num hide-sm">${owed.length ? sumBy(owed, (d) => totals(d).due) + " due" : "—"}</td>
      <td style="text-align:right;white-space:nowrap"><a class="btn sm" href="#/new/invoice/${esc(cl.id)}">Invoice</a>
      <a class="btn sm" href="#/new/quote/${esc(cl.id)}">Quote</a>
      <button class="btn sm ghost" data-edit="${esc(cl.id)}">Edit</button></td></tr>`;
  }).join("");
  view.innerHTML = `<div class="page-head"><h1>Clients</h1></div>
    <div class="card"><h2>${c.id ? "Edit client" : "Add a client"}</h2>
      <form id="clientForm" class="grid g2" onsubmit="return false">
        <div><label for="cl-name">Name</label><input id="cl-name" name="name" value="${esc(c.name)}" required></div>
        <div><label for="cl-email">Email</label><input id="cl-email" name="email" type="email" value="${esc(c.email)}"></div>
        <div><label for="cl-phone">Phone</label><input id="cl-phone" name="phone" value="${esc(c.phone)}"></div>
        <div><label for="cl-tax">${esc(s.taxLabel || "Tax")} number</label><input id="cl-tax" name="taxId" value="${esc(c.taxId)}"></div>
        <div class="span2"><label for="cl-addr">Address</label><textarea id="cl-addr" name="address" rows="2">${esc(c.address)}</textarea></div>
        <div class="span2 actions"><button class="btn primary" type="submit">${c.id ? "Save changes" : "Add client"}</button>
          ${c.id ? `<a class="btn" href="#/clients">Cancel</a><button class="btn danger" type="button" data-act="delClient">Delete client</button>` : ""}</div>
      </form></div>
    <div class="card"><h2>Saved clients</h2>${rows ? `<table class="list"><tbody>${rows}</tbody></table>` : `<p class="muted">No clients yet. Add one above, or press "Save client" while making an invoice.</p>`}</div>`;
  $("#clientForm").onsubmit = (e) => {
    e.preventDefault();
    const f = new FormData(e.target), data = Object.fromEntries([...f.entries()].map(([k, v]) => [k, String(v).trim()]));
    if (!data.name) return toast("Add a name for the client.");
    if (c.id) {
      Object.assign(state.clients.find((x) => x.id === c.id), data);
      state.docs.forEach((d) => { if (d.clientId === c.id && d.status === "draft") d.client = pick(data); });
    } else state.clients.push({ id: uid(), ...data });
    save(); toast(`${data.name} saved.`); viewClients();
  };
  const dc = $('[data-act="delClient"]');
  if (dc) dc.onclick = () => {
    if (!confirm(`Delete ${c.name} from your clients? Their invoices stay as they are.`)) return;
    state.clients = state.clients.filter((x) => x.id !== c.id); save(); viewClients();
  };
  $$("[data-edit]").forEach((b) => b.onclick = () => { viewClients(b.dataset.edit); window.scrollTo(0, 0); });
}

// ---------------- settings ----------------
function viewSettings(section) {
  const p = state.profile, s = state.settings, L = state.license, pro = isPro();
  const licenseCard = pro && L.kind === "code" && !DEMO
    ? `<p><b>Pro is unlocked for good</b> with your AppSumo code.</p>
       <p class="muted">Your code is saved only on this device. To use Pro on another device, enter the same code there, so keep a copy of it.</p>
       <div class="actions"><button class="btn danger" data-act="unlicense">Remove code from this device</button></div>`
    : pro
    ? `<p><b>Pro is active${DEMO ? " (demo mode)" : ""}.</b> ${L.email ? "Licensed to " + esc(L.email) + "." : ""} ${L.recurrence ? "Billed " + esc(L.recurrence) + "." : ""}</p>
       ${L.cancelled ? `<p class="muted">Your subscription is cancelled and Pro stays on until the paid period ends.</p>` : ""}
       ${DEMO ? "" : `<div class="actions"><a class="btn" href="${esc(GUMROAD.manageUrl)}" target="_blank" rel="noopener">Manage subscription</a>
       <button class="btn" data-act="recheck">Check again now</button><button class="btn danger" data-act="unlicense">Remove key from this device</button></div>`}`
    : `${L.status === "inactive" ? `<p style="color:var(--bad)">Your Pro subscription is no longer active, so the free plan applies. Renew on Gumroad, then press Activate.</p>` : ""}
       ${proPitch()}
       <div class="grid g2" style="margin-top:14px"><div class="span2"><label for="licKey">Your AppSumo code, or the license key from your Gumroad receipt</label>
       <div class="actions" style="flex-wrap:nowrap"><input id="licKey" value="${esc(L.key)}" placeholder="EIM-XXXX-XXXX-XXXX" spellcheck="false" autocomplete="off">
       <button class="btn primary" data-act="activate">Activate</button></div></div></div>`;
  view.innerHTML = `<div class="page-head"><h1>Settings</h1><span class="saved-flag" id="savedFlag">Changes save automatically</span></div>
    <form id="setForm" autocomplete="off" onsubmit="return false">
    <div class="card"><h2>Your business</h2>
      <div class="grid g2">
        <div><label for="s-name">Business name</label><input id="s-name" data-s="profile.name" value="${esc(p.name)}"></div>
        <div><label for="s-tag">Tagline</label><input id="s-tag" data-s="profile.tagline" value="${esc(p.tagline)}" placeholder="Optional"></div>
        <div><label for="s-email">Email</label><input id="s-email" type="email" data-s="profile.email" value="${esc(p.email)}"></div>
        <div><label for="s-phone">Phone</label><input id="s-phone" data-s="profile.phone" value="${esc(p.phone)}"></div>
        <div><label for="s-web">Website</label><input id="s-web" data-s="profile.website" value="${esc(p.website)}" placeholder="Optional"></div>
        <div><label for="s-taxid">${esc(s.taxLabel || "Tax")} number</label><input id="s-taxid" data-s="profile.taxId" value="${esc(p.taxId)}" placeholder="e.g. GSTIN, VAT number"></div>
        <div class="span2"><label for="s-addr">Address</label><textarea id="s-addr" data-s="profile.address" rows="2">${esc(p.address)}</textarea></div>
        <div class="span2"><label for="s-pay">Payment details (shown on invoices)</label><textarea id="s-pay" data-s="profile.payment" rows="3" placeholder="Bank name, account number, IFSC / SWIFT, UPI ID…">${esc(p.payment)}</textarea></div>
        <div><label>Logo</label><div class="img-slot">${p.logo ? `<img src="${p.logo}" alt="Your logo">` : ""}
          <input type="file" accept="image/*" data-img="logo" aria-label="Upload logo">${p.logo ? `<button class="btn sm" type="button" data-clear="logo">Remove</button>` : ""}</div></div>
        <div><label>Signature ${lockTag()}</label><div class="img-slot">${p.signature ? `<img src="${p.signature}" alt="Your signature">` : ""}
          <input type="file" accept="image/*" data-img="signature" aria-label="Upload signature" ${pro ? "" : "disabled"}>${p.signature ? `<button class="btn sm" type="button" data-clear="signature">Remove</button>` : ""}</div></div>
      </div></div>
    <div class="card"><h2>Defaults for new documents</h2>
      <div class="grid g4">
        <div><label for="d-cur">Currency</label><select id="d-cur" data-s="settings.currency">${opts(CURRENCIES.map(([c, n]) => [c, c + " – " + n]), s.currency)}</select></div>
        <div><label for="d-tl">Tax name</label><input id="d-tl" data-s="settings.taxLabel" value="${esc(s.taxLabel)}" placeholder="GST, VAT, Tax"></div>
        <div><label for="d-tr">Tax rate %</label><input id="d-tr" type="number" step="any" min="0" data-s="settings.taxRate" value="${esc(s.taxRate)}"></div>
        <div><label for="d-tpl">Template ${lockTag()}</label><select id="d-tpl" data-s="settings.template" ${pro ? "" : "disabled"}>${opts(TEMPLATES, pro ? s.template : "classic")}</select></div>
        <div><label for="d-ip">Invoice prefix</label><input id="d-ip" data-s="settings.invPrefix" value="${esc(s.invPrefix)}"></div>
        <div><label for="d-in">Next invoice no.</label><input id="d-in" type="number" min="1" data-s="settings.nextInv" value="${esc(s.nextInv)}"></div>
        <div><label for="d-qp">Quotation prefix</label><input id="d-qp" data-s="settings.quoPrefix" value="${esc(s.quoPrefix)}"></div>
        <div><label for="d-qn">Next quotation no.</label><input id="d-qn" type="number" min="1" data-s="settings.nextQuo" value="${esc(s.nextQuo)}"></div>
        <div><label for="d-dd">Invoice due in (days)</label><input id="d-dd" type="number" min="0" data-s="settings.dueDays" value="${esc(s.dueDays)}"></div>
        <div><label for="d-vd">Quote valid for (days)</label><input id="d-vd" type="number" min="0" data-s="settings.validDays" value="${esc(s.validDays)}"></div>
        <div><label for="d-acc">Accent colour ${lockTag()}</label><input id="d-acc" type="color" data-s="settings.accent" value="${esc(s.accent)}" ${pro ? "" : "disabled"}></div>
        <div style="align-self:end"><label class="check"><input type="checkbox" data-s="settings.amountInWords" ${s.amountInWords ? "checked" : ""}> Show amount in words</label></div>
      </div>
      <div class="grid g3" style="margin-top:12px">
        <div><label for="d-notes">Note to client</label><textarea id="d-notes" data-s="settings.notes" rows="3">${esc(s.notes)}</textarea></div>
        <div><label for="d-terms">Invoice terms</label><textarea id="d-terms" data-s="settings.terms" rows="3">${esc(s.terms)}</textarea></div>
        <div><label for="d-qterms">Quotation terms</label><textarea id="d-qterms" data-s="settings.quoteTerms" rows="3">${esc(s.quoteTerms)}</textarea></div>
      </div></div>
    </form>
    <div class="card ${pro ? "" : "upsell"}" id="pro"><h2>Plan: ${pro ? "Pro" : "Free"}</h2>${licenseCard}</div>
    <div class="card"><h2>Backup &amp; data</h2>
      <p class="muted">Everything is stored only in this app on this device. Export a backup now and then, and use it to move to a new device.</p>
      <div class="actions"><button class="btn" data-act="export">Export backup (.json)</button>
        <label class="btn" style="margin:0;color:var(--text);font-size:inherit">Import backup<input type="file" accept="application/json,.json" data-act="import" hidden></label>
        <button class="btn" data-act="csv">Export invoices CSV ${lockTag()}</button>
        <button class="btn" data-act="sample">Load sample data</button>
        <button class="btn danger" data-act="wipe">Erase all data</button></div>
      <p class="muted small" style="margin-top:14px">Eksoch Invoice Maker · <a href="privacy.html">Privacy policy</a></p></div>`;
  const form = $("#setForm");
  form.addEventListener("input", (e) => {
    const el = e.target, path = el.dataset.s; if (!path) return;
    let v = el.type === "checkbox" ? el.checked : el.value;
    if (el.type === "number") v = num(v);
    setPath(state, path, v); saveSoon();
  });
  $$("[data-img]").forEach((inp) => inp.onchange = async () => {
    const f = inp.files[0]; if (!f) return;
    try { state.profile[inp.dataset.img] = await shrinkImage(f, inp.dataset.img === "logo" ? 480 : 400); save(); viewSettings(); }
    catch (e) { toast("That image couldn't be read. Try a PNG or JPG."); }
  });
  $$("[data-clear]").forEach((b) => b.onclick = () => { state.profile[b.dataset.clear] = ""; save(); viewSettings(); });
  const on = (act, fn) => { const el = $(`[data-act="${act}"]`); if (el) el[act === "import" ? "onchange" : "onclick"] = fn; };
  on("activate", async () => {
    const key = $("#licKey").value.trim();
    if (!key) return toast("Paste your AppSumo code or the license key from your Gumroad receipt.");
    const b = $('[data-act="activate"]'); b.disabled = true; b.textContent = "Checking…";
    const r = await activate(key);
    if (r.ok) { toast(r.code ? "Pro is unlocked. Thank you!" : "Pro is on. Thank you for subscribing!"); viewSettings("pro"); }
    else { b.disabled = false; b.textContent = "Activate"; toast(r.reason); }
  });
  on("recheck", async () => { state.license.checkedAt = 0; await recheckLicense(); if (isPro()) toast("Your subscription is active."); viewSettings("pro"); });
  on("unlicense", () => { if (!confirm(L.kind === "code" ? "Remove your Pro code from this device? Keep a copy of it so you can enter it again." : "Remove the Pro license key from this device?")) return; state.license = defaults().license; save(); renderBadge(); viewSettings("pro"); });
  on("export", exportBackup);
  on("import", (e) => importBackup(e.target.files[0]));
  on("csv", exportCSV);
  on("sample", loadSample);
  on("wipe", () => {
    if (!confirm("Erase every invoice, quotation, client and setting on this device? Export a backup first if you might need them.")) return;
    const lic = state.license; state = defaults(); state.license = lic; save(); renderBadge(); location.hash = "#/";
    toast("All data erased.");
  });
  if (section === "pro") requestAnimationFrame(() => requestAnimationFrame(() => $("#pro")?.scrollIntoView({ block: "start" })));
}
function shrinkImage(file, max) {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onerror = reject;
    r.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const sc = Math.min(1, max / Math.max(img.width, img.height));
        const c = document.createElement("canvas");
        c.width = Math.round(img.width * sc); c.height = Math.round(img.height * sc);
        c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
        resolve(c.toDataURL("image/png"));
      };
      img.src = r.result;
    };
    r.readAsDataURL(file);
  });
}

// ---------------- import / export ----------------
function download(name, text, type) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type }));
  a.download = name; document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}
function exportBackup() {
  const { license, ...data } = state;
  download(`invoice-maker-backup-${today()}.json`, JSON.stringify({ app: "eksoch-invoice-maker", version: 1, ...data }, null, 2), "application/json");
  toast("Backup downloaded.");
}
function importBackup(file) {
  if (!file) return;
  const r = new FileReader();
  r.onload = () => {
    try {
      const data = JSON.parse(r.result);
      if (!Array.isArray(data.docs) || !data.settings) throw new Error("bad");
      if (!confirm(`Replace what's on this device with this backup (${data.docs.length} documents, ${(data.clients || []).length} clients)?`)) return;
      const lic = state.license; state = merge(data); state.license = lic; save(); renderBadge();
      toast("Backup restored."); location.hash = "#/";
    } catch (e) { toast("That file isn't an Invoice Maker backup."); }
  };
  r.readAsText(file);
}
function exportCSV() {
  if (!isPro()) { toast("CSV export is part of Pro."); location.hash = "#/settings/pro"; return; }
  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const head = ["Type", "Number", "Status", "Client", "Client email", "Issue date", "Due / valid until", "Currency", "Subtotal", "Discount", "Tax", "Shipping", "Total", "Paid", "Balance"];
  const rows = [...state.docs].sort((a, b) => (a.issueDate || "").localeCompare(b.issueDate || "")).map((d) => {
    const t = totals(d);
    return [d.type, d.number, statusOf(d), d.client?.name, d.client?.email, d.issueDate, d.dueDate, d.currency,
      t.subtotal.toFixed(2), t.discount.toFixed(2), t.taxTotal.toFixed(2), t.shipping.toFixed(2), t.total.toFixed(2), t.paid.toFixed(2), t.due.toFixed(2)].map(q).join(",");
  });
  download(`invoices-${today()}.csv`, "﻿" + [head.map(q).join(","), ...rows].join("\r\n"), "text/csv");
  toast("CSV downloaded.");
}

// ---------------- sample data ----------------
function sampleState() {
  const s = defaults(), t = today();
  s.profile = {
    ...s.profile, name: "Chinar Craft Studio", tagline: "Handmade papier-mâché & walnut wood décor",
    address: "Residency Road, Lal Chowk\nSrinagar, Jammu & Kashmir 190001", email: "hello@chinarcraft.example", phone: "+91 98765 43210",
    website: "chinarcraft.example", taxId: "01ABCDE1234F1Z5",
    payment: "Bank: State Bank of India · A/c 0000 1234 5678\nIFSC: SBIN0000123 · UPI: chinarcraft@upi",
  };
  s.settings.nextInv = 5; s.settings.nextQuo = 4;
  s.clients = [
    { id: "c1", name: "Dal Lake Boutique Hotel", email: "accounts@dallake.example", phone: "+91 94190 11111", address: "Boulevard Road\nSrinagar 190001", taxId: "01AAACD1111A1Z1" },
    { id: "c2", name: "Saffron & Co. Interiors", email: "orders@saffronco.example", phone: "+91 98110 22222", address: "14 Khan Market\nNew Delhi 110003", taxId: "07AAACS2222B1Z2" },
    { id: "c3", name: "Meera Kapoor", email: "meera@example.com", phone: "+91 99000 33333", address: "Bandra West, Mumbai 400050", taxId: "" },
  ];
  const mk = (id, type, number, status, cid, issueOff, dueOff, items, extra = {}) => {
    const c = s.clients.find((x) => x.id === cid);
    return {
      id, type, number, status, clientId: cid, client: pick(c), issueDate: addDays(t, issueOff), dueDate: addDays(t, dueOff),
      currency: "INR", template: extra.template || "classic", accent: extra.accent || "#1f6f78", items, discountType: "pct", discount: extra.discount || "",
      shipping: extra.shipping || "", amountPaid: extra.amountPaid || "", notes: s.settings.notes,
      terms: type === "invoice" ? s.settings.terms : s.settings.quoteTerms, reference: extra.reference || "", fromQuote: extra.fromQuote || "",
      createdAt: new Date(Date.now() + issueOff * 86400e3).toISOString(), updatedAt: new Date(Date.now() + issueOff * 86400e3).toISOString(),
      paidDate: status === "paid" ? addDays(t, extra.paidOff ?? -1) : "",
    };
  };
  s.docs = [
    mk("d1", "invoice", "INV-0004", "sent", "c1", -3, 12, [
      { desc: "Papier-mâché wall plates, chinar leaf design (set of 6)", qty: 4, rate: 4800, tax: 12 },
      { desc: "Walnut wood carved room-divider screen", qty: 1, rate: 38500, tax: 12 },
      { desc: "Packing & insured delivery", qty: 1, rate: 2500, tax: 18 }], { reference: "PO-7781", template: "modern", accent: "#16324f", fromQuote: "QUO-0003" }),
    mk("d2", "invoice", "INV-0003", "sent", "c2", -28, -6, [
      { desc: "Hand-painted papier-mâché lamp bases", qty: 12, rate: 2200, tax: 12 },
      { desc: "Custom colour matching to client swatches", qty: 1, rate: 3000, tax: 18 }], { discount: 5 }),
    mk("d3", "invoice", "INV-0002", "paid", "c3", -12, 3, [
      { desc: "Walnut wood jewellery box with brass inlay", qty: 2, rate: 6500, tax: 12 }], { amountPaid: "14560", paidOff: -2 }),
    mk("d4", "invoice", "INV-0001", "sent", "c1", -20, 10, [
      { desc: "Kashmiri crewel-embroidered cushion covers", qty: 20, rate: 1450, tax: 5 }], { amountPaid: "15000" }),
    mk("d5", "quote", "QUO-0003", "invoiced", "c1", -9, 21, [
      { desc: "Papier-mâché wall plates, chinar leaf design (set of 6)", qty: 4, rate: 4800, tax: 12 },
      { desc: "Walnut wood carved room-divider screen", qty: 1, rate: 38500, tax: 12 }]),
    mk("d6", "quote", "QUO-0002", "sent", "c2", -2, 28, [
      { desc: "Lobby installation: 40 hand-painted papier-mâché panels", qty: 40, rate: 3200, tax: 12 },
      { desc: "On-site installation (2 artisans, 3 days)", qty: 6, rate: 4500, tax: 18 }], { discount: 8, template: "elegant", accent: "#7a3b2e" }),
  ];
  return s;
}
function loadSample() {
  if (state.docs.length && !confirm("Replace your current data with sample data? Export a backup first if you need it.")) return;
  const lic = state.license; state = sampleState(); state.license = lic; save(); renderBadge();
  toast("Sample data loaded."); location.hash = "#/"; route();
}

// ---------------- start ----------------
window.addEventListener("hashchange", route);
window.addEventListener("resize", () => fitPreview());
window.addEventListener("online", recheckLicense);
state = DEMO ? sampleState() : load();
renderBadge();
route();
recheckLicense();
