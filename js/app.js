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
    const booksSnapshot = await getDocs(
      query(collection(db, "books"), orderBy("created_at", "desc"))
    );

    allBooks = [];
    booksSnapshot.forEach(doc => {
      allBooks.push({ id: doc.id, ...doc.data() });
    });

    filteredBooks = [...allBooks];
    displayBooks();
  } catch (error) {
    console.error('Error loading books:', error);
    document.getElementById('loadingState').textContent = 'Error loading books. Please refresh.';
  }
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
    ? `<img src="${book.cover_image}" alt="${book.title}" class="book-cover-img" loading="lazy">`
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
function showBookDetails(book) {
  const modal = document.getElementById('bookModal');
  const modalBody = document.getElementById('modalBody');

  const coverImg = book.cover_image
    ? `<img src="${book.cover_image}" alt="${book.title}" class="modal-cover">`
    : '';

  const platforms = getPlatformPrices(book);
  const lowest = getLowestPrice(book);

  const purchaseHTML = platforms.map(p => {
    const isLowest = p.price === lowest;
    let detail = '';
    let buyHref = '#';
    let buyLabel = 'Buy now';

    if (p.key === 'aspect') {
      detail = `Use promo code <span class="code">${book.aspect_promo_code || 'ABCDEF'}</span>`;
      buyHref = book.affiliate_links?.aspect_direct || '#';
    } else if (p.key === 'rokomari') {
      detail = 'Direct link at Rokomari.com';
      buyHref = book.affiliate_links?.rokomari || '#';
    } else if (p.key === 'bkash') {
      detail = `Pay via Bkash: <strong>${book.bkash_number || 'Contact us'}</strong>`;
      buyLabel = 'Contact to buy';
      buyHref = `https://wa.me/8801XXXXXXXXX?text=${encodeURIComponent('I want to buy: ' + book.title)}`;
    } else if (p.key.startsWith('custom_')) {
      detail = p.promo ? `Use promo code <span class="code">${p.promo}</span>` : `Direct link at ${p.name}`;
      buyHref = p.url || '#';
    }

    return `
      <div class="purchase-option ${isLowest ? 'purchase-option-lowest' : ''}">
        <div class="purchase-option-info">
          <div class="purchase-option-name">${p.name} ${isLowest ? '<span class="lowest-tag">Lowest</span>' : ''}</div>
          <div class="purchase-option-detail">${detail}</div>
        </div>
        <div style="display:flex; align-items:center; gap:14px;">
          <div class="purchase-option-price">${p.price.toLocaleString()}</div>
          <a href="${buyHref}" target="_blank" class="btn-buy-now">${buyLabel}</a>
        </div>
      </div>
    `;
  }).join('');

  modalBody.innerHTML = `
    <div class="modal-category">${book.category || 'Uncategorized'}</div>
    <h2 class="modal-title">${book.title}</h2>
    ${coverImg}
    <p class="modal-desc">${book.description || 'No description available.'}</p>
    <div class="modal-meta">
      <p><strong>Author:</strong> ${book.author || 'Unknown'}</p>
      <p><strong>Pages:</strong> ${book.pages || 'N/A'}</p>
      <p><strong>Language:</strong> ${book.language || 'Bangla & English'}</p>
      <p><strong>Platforms:</strong> ${platforms.length}</p>
    </div>
    <div class="purchase-section-title">Buy from</div>
    ${purchaseHTML || '<p class="modal-desc">Purchase options coming soon.</p>'}
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

