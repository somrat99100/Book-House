import { db } from './firebase-config.js';
import { collection, getDocs, query, orderBy } from "https://www.gstatic.com/firebasejs/9.22.0/firebase-firestore.js";

let allBooks = [];
let filteredBooks = [];
let currentFilters = {
  publisher: 'all',
  category: 'all',
  search: ''
};

// Fallback demo data used only if Firestore has nothing yet, so the page
// never looks broken while you're still adding real content in the admin panel.
const FALLBACK_PUBLISHERS = [
  { id: 'aspectSeries', name: 'Aspect Series', affiliate_code: 'ABCDEF' },
  { id: 'rokomari', name: 'Rokomari', affiliate_code: 'ROKO2026' }
];

document.addEventListener('DOMContentLoaded', async () => {
  const publishers = await loadPublishers();
  await loadCategories();
  await loadBooks();
  setupEventListeners();
  startProjector(publishers);
});

/* ==========================================================
   PUBLISHERS + CATEGORIES (drive the sidebar filters)
   ========================================================== */
async function loadPublishers() {
  const publisherFilter = document.getElementById('publisherFilter');
  let publishers = [];
  try {
    const snapshot = await getDocs(collection(db, "publishers"));
    snapshot.forEach(doc => {
      publishers.push({ id: doc.id, ...doc.data() });
    });
  } catch (error) {
    console.error('Error loading publishers:', error);
  }

  if (publishers.length === 0) publishers = FALLBACK_PUBLISHERS;

  publishers.forEach(pub => {
    const option = document.createElement('div');
    option.className = 'filter-option';
    option.setAttribute('data-publisher', pub.id);
    option.textContent = pub.name;
    publisherFilter.appendChild(option);
  });

  return publishers;
}

async function loadCategories() {
  const categoryFilter = document.getElementById('categoryFilter');
  try {
    const snapshot = await getDocs(collection(db, "categories"));
    snapshot.forEach(doc => {
      const category = doc.data();
      const option = document.createElement('div');
      option.className = 'filter-option';
      option.setAttribute('data-category', doc.id);
      option.textContent = category.name;
      categoryFilter.appendChild(option);
    });
  } catch (error) {
    console.error('Error loading categories:', error);
  }
}

/* ==========================================================
   THE PROJECTOR — cycles promo codes every 30s with a fade
   ========================================================== */
function startProjector(publishers) {
  const withCodes = publishers.filter(p => p.affiliate_code);
  if (withCodes.length === 0) return;

  const labelEl = document.getElementById('promoLabel');
  const codeEl = document.getElementById('promoCode');
  const slideEl = document.getElementById('promoSlide');
  const dotsEl = document.getElementById('promoDots');

  dotsEl.innerHTML = withCodes.map((_, i) => `<span data-i="${i}"></span>`).join('');
  const dots = [...dotsEl.children];

  let index = 0;

  function render(i) {
    const pub = withCodes[i];
    labelEl.textContent = `Promo Code for ${pub.name}`;
    codeEl.textContent = pub.affiliate_code;
    dots.forEach((d, di) => d.classList.toggle('active', di === i));
  }

  render(0);

  setInterval(() => {
    slideEl.classList.add('is-changing');
    setTimeout(() => {
      index = (index + 1) % withCodes.length;
      render(index);
      slideEl.classList.remove('is-changing');
    }, 500);
  }, 30000);
}

/* ==========================================================
   BOOKS
   ========================================================== */
async function loadBooks() {
  try {
    // Fetch without orderBy: Firestore silently drops any document missing the
    // sort field from an orderBy query, which would make a book vanish from the
    // homepage with no error. Sort client-side instead, tolerating missing/odd
    // created_at values so nothing gets hidden by accident.
    const booksSnapshot = await getDocs(collection(db, "books"));

    allBooks = [];
    booksSnapshot.forEach(doc => {
      allBooks.push({ id: doc.id, ...doc.data() });
    });

    allBooks.sort((a, b) => toMillis(b.created_at) - toMillis(a.created_at));

    filteredBooks = [...allBooks];
    displayBooks();
  } catch (error) {
    console.error('Error loading books:', error);
    document.getElementById('loadingState').textContent =
      `Error loading books: ${error.message}. Check the browser console (F12) and your Firestore rules.`;
  }
}

/* ----------------------------------------------------------
   GOOGLE DRIVE LINK HELPERS
   Books added via the admin's Google Sheet import (or typed in
   manually) may have Drive "share" links for cover_image / pdf_url,
   which don't work directly in <img src> or an <iframe>. Convert them
   to the actual embeddable form at render time. Non-Drive URLs
   (Cloudinary, direct .jpg/.pdf links, etc.) pass through unchanged.
   Kept in sync with the same helpers in dashboard.html.
   ---------------------------------------------------------- */
function driveFileId(url) {
  if (!url) return '';
  const s = String(url);
  const m = s.match(/\/file\/d\/([a-zA-Z0-9_-]+)/) || s.match(/[?&]id=([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}
function isDriveUrl(url) {
  return /drive\.google\.com/i.test(String(url || ''));
}
function toDriveImageUrl(url) {
  if (!url || !isDriveUrl(url)) return url || '';
  const id = driveFileId(url);
  return id ? `https://drive.google.com/thumbnail?id=${id}&sz=w1000` : url;
}
function toDrivePdfPreviewUrl(url) {
  if (!url || !isDriveUrl(url)) return url || '';
  const id = driveFileId(url);
  return id ? `https://drive.google.com/file/d/${id}/preview` : url;
}

// Firestore Timestamps, JS Dates, and missing values all need to sort safely together.
function toMillis(value) {
  if (!value) return 0;
  if (typeof value.toMillis === 'function') return value.toMillis(); // Firestore Timestamp
  if (value instanceof Date) return value.getTime();
  const parsed = new Date(value);
  return isNaN(parsed) ? 0 : parsed.getTime();
}

// Work out the lowest price across whichever purchase sources this book has.
// Supports the legacy `prices` object ({aspect, rokomari, bkash}), a flat `price`,
// and the generic `purchase_options` array produced by the "bulk import from any
// website" tool in the admin panel ([{platform, price, url, promo_code}]).
function getPlatformPrices(book) {
  const platforms = [];

  if (book.prices) {
    if (book.prices.aspect != null) platforms.push({ key: 'aspect', name: 'Aspect Series', price: book.prices.aspect });
    if (book.prices.rokomari != null) platforms.push({ key: 'rokomari', name: 'Rokomari', price: book.prices.rokomari });
    if (book.prices.bkash != null) platforms.push({ key: 'bkash', name: 'Books House (Bkash)', price: book.prices.bkash });
  } else if (book.price != null) {
    platforms.push({ key: 'bkash', name: 'Books House (Bkash)', price: book.price });
  }

  if (Array.isArray(book.purchase_options)) {
    book.purchase_options.forEach((opt, i) => {
      if (opt.price == null) return;
      platforms.push({
        key: `custom_${i}`,
        name: opt.platform || 'Online Store',
        price: opt.price,
        url: opt.url || '#',
        promo: opt.promo_code || null
      });
    });
  }

  return platforms;
}

function getLowestPrice(book) {
  const platforms = getPlatformPrices(book);
  if (platforms.length === 0) return null;
  return Math.min(...platforms.map(p => p.price));
}

function displayBooks() {
  const grid = document.getElementById('booksGrid');
  const count = document.getElementById('bookCount');

  grid.innerHTML = '';

  if (filteredBooks.length === 0) {
    grid.innerHTML = '<div class="loading-state">No books found matching your criteria.</div>';
    count.textContent = '0 books';
    return;
  }

  filteredBooks.forEach(book => {
    grid.appendChild(createBookCard(book));
  });

  count.textContent = `${filteredBooks.length} books`;
}

function createBookCard(book) {
  const card = document.createElement('div');
  card.className = 'book-card';

  const coverHTML = book.cover_image
    ? `<img src="${toDriveImageUrl(book.cover_image)}" alt="${book.title}" class="book-cover-img" loading="lazy" onerror="this.parentElement.innerHTML='<div class=\\'book-cover-placeholder\\'>No Cover</div>'">`
    : `<div class="book-cover-placeholder">No Cover</div>`;

  const lowest = getLowestPrice(book);

  card.innerHTML = `
    <div class="book-cover">${coverHTML}</div>
    <div class="book-info">
      <div class="book-category-badge">${book.category || 'Uncategorized'}</div>
      <div class="book-title">${book.title}</div>
      <div class="book-price-row">
        <span class="book-price-label">Lowest price</span>
        <span class="book-price">${lowest != null ? lowest.toLocaleString() : '—'}</span>
      </div>
      <button class="btn-show-more" type="button">Show more</button>
    </div>
  `;

  card.querySelector('.btn-show-more').addEventListener('click', (e) => {
    e.stopPropagation();
    showBookDetails(book);
  });
  card.querySelector('.book-cover').addEventListener('click', () => showBookDetails(book));
  card.querySelector('.book-title').addEventListener('click', () => showBookDetails(book));

  return card;
}

/* ==========================================================
   MODAL — full detail + buy-now purchase options
   ========================================================== */
// Minimal escaping for values we drop into HTML attributes (title, platform
// name) so a stray quote in Firestore data can't break the markup.
function escapeAttr(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

// Books House contact number for WhatsApp chat + order forms.
const WHATSAPP_NUMBER = '8801753486065';

// Bangladesh's 64 districts, for the "Books House" order form's জেলা field.
const BD_DISTRICTS = [
  'ঢাকা','রাজশাহী','চট্টগ্রাম','খুলনা','বরিশাল','সিলেট','রংপুর','কক্সবাজার','কিশোরগঞ্জ','কুড়িগ্রাম',
  'কুমিল্লা','কুষ্টিয়া','খাগড়াছড়ি','গাইবান্ধা','গাজীপুর','গোপালগঞ্জ','চাঁদপুর','চাঁপাইনবাবগঞ্জ','চুয়াডাঙ্গা',
  'জয়পুরহাট','জামালপুর','ঝালকাঠি','ঝিনাইদহ','টাঙ্গাইল','ঠাকুরগাঁও','দিনাজপুর','নওগাঁ','নড়াইল','নরসিংদী',
  'নাটোর','নারায়ণগঞ্জ','নীলফামারী','নেত্রকোনা','নোয়াখালী','পঞ্চগড়','পটুয়াখালী','পাবনা','পিরোজপুর','ফরিদপুর',
  'ফেনী','বগুড়া','বরগুনা','বাগেরহাট','বান্দরবান','ব্রাহ্মণবাড়িয়া','ভোলা','ময়মনসিংহ','মাগুরা','মাদারীপুর',
  'মানিকগঞ্জ','মুন্সিগঞ্জ','মেহেরপুর','মৌলভীবাজার','যশোর','রাঙ্গামাটি','রাজবাড়ী','লক্ষ্মীপুর','লালমনিরহাট',
  'শরিয়তপুর','শেরপুর','সাতক্ষীরা','সিরাজগঞ্জ','সুনামগঞ্জ','হবিগঞ্জ'
];

function showBookDetails(book) {
  const modal = document.getElementById('bookModal');
  const modalBody = document.getElementById('modalBody');

  const coverHTML = book.cover_image
    ? `<div class="modal-cover-frame"><img src="${toDriveImageUrl(book.cover_image)}" alt="${escapeAttr(book.title)}" class="modal-cover" onerror="this.parentElement.remove()"></div>`
    : '';

  const pdfPreviewUrl = book.pdf_url ? toDrivePdfPreviewUrl(book.pdf_url) : '';
  const pdfSectionHTML = pdfPreviewUrl ? `
    <div class="purchase-section-title">Preview</div>
    <button type="button" class="btn-buy-now" id="pdfToggleBtn" style="margin-bottom:6px;" onclick="
      const f = document.getElementById('pdfPreviewFrame');
      const showing = f.style.display !== 'none';
      f.style.display = showing ? 'none' : 'block';
      this.textContent = showing ? 'Preview PDF' : 'Hide preview';
    ">Preview PDF</button>
    <iframe id="pdfPreviewFrame" src="${pdfPreviewUrl}" style="display:none; width:100%; height:480px; border:1px solid #e8e6e0; border-radius:6px; margin-bottom:14px;" allow="autoplay"></iframe>
  ` : '';

  const platforms = getPlatformPrices(book);
  const lowest = getLowestPrice(book);
  const bookTitleAttr = escapeAttr(book.title);

  // The full delivery-details form used by any platform without a direct
  // link (Books House / Bkash, or a custom entry missing a URL) — collects
  // what's needed to hand the order straight to a courier, then sends it
  // all to WhatsApp.
  function buildOrderForm(formId, platformName) {
    const districtOptions = BD_DISTRICTS.map(d => `<option value="${d}">${d}</option>`).join('');
    return `
      <div class="order-form" id="orderForm_${formId}" data-book-title="${bookTitleAttr}" data-platform-name="${escapeAttr(platformName)}">
        <div>
          <label>Full name*</label>
          <input type="text" id="orderName_${formId}" placeholder="Your name">
        </div>
        <div>
          <label>Phone number*</label>
          <input type="tel" id="orderPhone_${formId}" placeholder="01XXXXXXXXX">
        </div>
        <div>
          <label>ঠিকানা* (Address)</label>
          <textarea id="orderAddress_${formId}" placeholder="House, road, area..."></textarea>
        </div>
        <div>
          <label>Delivery charge</label>
          <select id="orderDelivery_${formId}">
            <option value="Home Delivery (Inside Dhaka, 80 ৳)">Home Delivery (Inside Dhaka, 80 ৳)</option>
            <option value="Home Delivery (Outside Dhaka, 140 ৳)">Home Delivery (Outside Dhaka, 140 ৳)</option>
            <option value="নিকটস্থ সুন্দরবন কুরিয়ার">নিকটস্থ সুন্দরবন কুরিয়ার</option>
          </select>
        </div>
        <div class="order-form-row">
          <div>
            <label>জেলা* (District)</label>
            <select id="orderDistrict_${formId}">
              <option value="">Select District</option>
              ${districtOptions}
            </select>
          </div>
          <div>
            <label>অঞ্চল* (Area)</label>
            <input type="text" id="orderArea_${formId}" placeholder="e.g. Mirpur">
          </div>
        </div>
        <button type="button" class="btn-send-order" onclick="
          const wrap = document.getElementById('orderForm_${formId}');
          const name = document.getElementById('orderName_${formId}').value.trim();
          const phone = document.getElementById('orderPhone_${formId}').value.trim();
          const address = document.getElementById('orderAddress_${formId}').value.trim();
          const delivery = document.getElementById('orderDelivery_${formId}').value;
          const district = document.getElementById('orderDistrict_${formId}').value;
          const area = document.getElementById('orderArea_${formId}').value.trim();
          if (!name || !phone || !address || !district || !area) { alert('Please fill in all required (*) fields.'); return; }
          const msg = 'Order request' + String.fromCharCode(10)
            + 'Book: ' + wrap.dataset.bookTitle + String.fromCharCode(10)
            + 'Platform: ' + wrap.dataset.platformName + String.fromCharCode(10)
            + 'Name: ' + name + String.fromCharCode(10)
            + 'Phone: ' + phone + String.fromCharCode(10)
            + 'Address: ' + address + String.fromCharCode(10)
            + 'District: ' + district + String.fromCharCode(10)
            + 'Area: ' + area + String.fromCharCode(10)
            + 'Delivery: ' + delivery;
          window.open('https://wa.me/${WHATSAPP_NUMBER}?text=' + encodeURIComponent(msg), '_blank');
        ">Send order via WhatsApp</button>
      </div>`;
  }

  const purchaseHTML = platforms.map(p => {
    const isLowest = p.price === lowest;
    const formId = p.key;
    let detail = '';
    let actionHTML = '';

    if (p.key === 'aspect') {
      // Aspect: direct affiliate link, plus a copyable promo code.
      const code = book.aspect_promo_code || 'ABCDEF';
      const buyHref = book.affiliate_links?.aspect_direct || '';
      detail = 'Copy the code below, then proceed to Aspect Series';
      actionHTML = `
        <div class="code-copy-row">
          <span class="code" id="promoCode_${formId}">${code}</span>
          <button type="button" class="btn-copy-code" onclick="
            navigator.clipboard.writeText('${code}');
            this.textContent = 'Copied!';
            this.classList.add('copied');
            setTimeout(() => { this.textContent = 'Copy code'; this.classList.remove('copied'); }, 1800);
          ">Copy code</button>
        </div>
        ${buyHref
          ? `<a href="${buyHref}" target="_blank" rel="noopener" class="btn-buy-now purchase-card-btn">Proceed to Aspect Series</a>`
          : `<span class="purchase-card-detail">Link coming soon</span>`}`;
    } else if (p.key === 'rokomari') {
      // Rokomari: direct link only.
      detail = 'Direct link at Rokomari.com';
      const buyHref = book.affiliate_links?.rokomari || '';
      actionHTML = buyHref
        ? `<a href="${buyHref}" target="_blank" rel="noopener" class="btn-buy-now purchase-card-btn">Buy on Rokomari</a>`
        : `<span class="purchase-card-detail">Link coming soon</span>`;
    } else if (p.key === 'bkash') {
      // Books House direct: WhatsApp chat + full delivery-details order form.
      detail = 'Order directly from Books House — chat on WhatsApp or fill in delivery details';
      const chatMsg = encodeURIComponent('I want to buy: ' + book.title);
      actionHTML = `
        <div class="purchase-card-actions">
          <a href="https://wa.me/${WHATSAPP_NUMBER}?text=${chatMsg}" target="_blank" rel="noopener" class="btn-whatsapp">Chat on WhatsApp</a>
          <button type="button" class="btn-buy-now purchase-card-btn" onclick="
            const f = document.getElementById('orderForm_${formId}');
            document.querySelectorAll('.order-form.active').forEach(el => { if (el !== f) el.classList.remove('active'); });
            f.classList.toggle('active');
          ">Order now</button>
        </div>
        ${buildOrderForm(formId, p.name)}`;
    } else {
      // Any custom bulk-imported platform: direct link if we have one,
      // otherwise fall back to the same order form.
      detail = p.promo ? `Use promo code <span class="code">${p.promo}</span>` : `Direct link at ${p.name}`;
      const buyHref = p.url || '';
      actionHTML = buyHref
        ? `<a href="${buyHref}" target="_blank" rel="noopener" class="btn-buy-now purchase-card-btn">Buy now</a>`
        : `<button type="button" class="btn-buy-now purchase-card-btn" onclick="
             const f = document.getElementById('orderForm_${formId}');
             document.querySelectorAll('.order-form.active').forEach(el => { if (el !== f) el.classList.remove('active'); });
             f.classList.toggle('active');
           ">Order now</button>
           ${buildOrderForm(formId, p.name)}`;
    }

    return `
      <div class="purchase-card ${isLowest ? 'is-lowest' : ''}">
        <div class="purchase-card-head">
          <div class="purchase-card-info">
            <div class="purchase-card-name">${p.name} ${isLowest ? '<span class="lowest-tag">Lowest</span>' : ''}</div>
            <div class="purchase-card-detail">${detail}</div>
          </div>
          <div class="purchase-card-price">${p.price.toLocaleString()}</div>
        </div>
        ${actionHTML}
      </div>
    `;
  }).join('');

  // Order: cover (full, framed) → details → buy options → PDF preview last.
  modalBody.innerHTML = `
    ${coverHTML}
    <div class="modal-category">${book.category || 'Uncategorized'}</div>
    <h2 class="modal-title">${book.title}</h2>
    <p class="modal-desc">${book.description || 'No description available.'}</p>
    <div class="modal-meta">
      <p><strong>Author:</strong> ${book.author || 'Unknown'}</p>
      <p><strong>Pages:</strong> ${book.pages || 'N/A'}</p>
      <p><strong>Language:</strong> ${book.language || 'Bangla & English'}</p>
      <p><strong>Platforms:</strong> ${platforms.length}</p>
    </div>
    <div class="purchase-section-title">Buy from</div>
    <div class="purchase-cards">
      ${purchaseHTML || '<p class="modal-desc">Purchase options coming soon.</p>'}
    </div>
    ${pdfSectionHTML}
  `;

  modal.classList.add('active');
}


/* ==========================================================
   FILTERS + EVENTS
   ========================================================== */
function setupEventListeners() {
  document.getElementById('searchInput').addEventListener('input', (e) => {
    currentFilters.search = e.target.value.toLowerCase();
    applyFilters();
  });

  document.getElementById('publisherFilter').addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-option')) {
      document.querySelectorAll('#publisherFilter .filter-option').forEach(opt => opt.classList.remove('active'));
      e.target.classList.add('active');
      currentFilters.publisher = e.target.getAttribute('data-publisher');
      applyFilters();
    }
  });

  document.getElementById('categoryFilter').addEventListener('click', (e) => {
    if (e.target.classList.contains('filter-option')) {
      document.querySelectorAll('#categoryFilter .filter-option').forEach(opt => opt.classList.remove('active'));
      e.target.classList.add('active');
      currentFilters.category = e.target.getAttribute('data-category');
      applyFilters();
    }
  });

  document.getElementById('modalClose').addEventListener('click', () => {
    document.getElementById('bookModal').classList.remove('active');
  });

  document.getElementById('bookModal').addEventListener('click', (e) => {
    if (e.target.id === 'bookModal') {
      document.getElementById('bookModal').classList.remove('active');
    }
  });
}

function applyFilters() {
  filteredBooks = allBooks.filter(book => {
    const matchPublisher = currentFilters.publisher === 'all' || book.publisher_id === currentFilters.publisher;
    const matchCategory = currentFilters.category === 'all' || book.category_id === currentFilters.category;
    const matchSearch = currentFilters.search === '' ||
      book.title.toLowerCase().includes(currentFilters.search) ||
      (book.author && book.author.toLowerCase().includes(currentFilters.search));

    return matchPublisher && matchCategory && matchSearch;
  });

  displayBooks();
}
