const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const resultsContainer = document.querySelector('#results');
const statusNode = document.querySelector('#status');
const template = document.querySelector('#result-template');
const recentSearchesToggle = document.querySelector('#recent-searches-toggle');
const recentSearchesPanel = document.querySelector('#recent-searches');
const recentSearchesList = document.querySelector('#recent-searches-list');
const recentSearchTemplate = document.querySelector('#recent-search-template');

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.dataset.error = String(isError);
}

function clearResults() {
  resultsContainer.innerHTML = '';
}

function formatDate(value) {
  if (!value) {
    return 'Fecha no disponible';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Fecha no disponible';
  }

  return new Intl.DateTimeFormat('es-ES', {
    dateStyle: 'short',
    timeStyle: 'short',
  }).format(date);
}

function renderRecentSearches(items) {
  recentSearchesList.innerHTML = '';

  if (!items.length) {
    const emptyState = document.createElement('p');
    emptyState.className = 'recent-searches-empty';
    emptyState.textContent = 'Todavia no hay busquedas guardadas.';
    recentSearchesList.appendChild(emptyState);
    return;
  }

  const fragment = document.createDocumentFragment();

  items.forEach((item) => {
    const node = recentSearchTemplate.content.firstElementChild.cloneNode(true);
    const query = node.querySelector('.recent-search-query');
    const meta = node.querySelector('.recent-search-meta');

    query.textContent = item.query || 'Busqueda sin texto';
    meta.textContent = `${item.count || 0} resultados · ${formatDate(item.fetchedAt)}`;
    node.addEventListener('click', () => {
      input.value = item.query || '';
      performSearch(item.query || '');
    });

    fragment.appendChild(node);
  });

  recentSearchesList.appendChild(fragment);
}

async function loadRecentSearches() {
  recentSearchesList.innerHTML = '';

  try {
    const response = await fetch('/api/recent-searches?limit=8');
    const payload = await response.json();

    if (!response.ok) {
      throw new Error('No fue posible leer las busquedas guardadas.');
    }

    renderRecentSearches(payload.items || []);
  } catch (error) {
    const errorNode = document.createElement('p');
    errorNode.className = 'recent-searches-empty';
    errorNode.textContent = error.message || 'No fue posible cargar las busquedas guardadas.';
    recentSearchesList.appendChild(errorNode);
  }
}

function renderResults(results) {
  clearResults();

  if (!results.length) {
    setStatus('No se encontraron resultados para esa busqueda.');
    return;
  }

  const fragment = document.createDocumentFragment();

  results.forEach((result) => {
    const node = template.content.firstElementChild.cloneNode(true);
    const media = node.querySelector('.result-media');
    const image = node.querySelector('img');
    const source = node.querySelector('.result-source');
    const title = node.querySelector('.result-title');
    const snippet = node.querySelector('.result-snippet');
    const link = node.querySelector('.result-link');

    source.textContent = result.source || 'Fuente desconocida';
    title.textContent = result.title || 'Sin titulo';
    snippet.textContent = result.snippet || 'Sin descripcion disponible.';
    link.href = result.url;
    link.textContent = result.url;

    if (result.image) {
      media.hidden = false;
      image.src = result.image;
      image.alt = `Imagen relacionada con ${result.title || 'el resultado'}`;
    }

    fragment.appendChild(node);
  });

  resultsContainer.appendChild(fragment);
  setStatus(`Se encontraron ${results.length} resultados.`);
}

async function performSearch(query) {
  if (!query) {
    setStatus('Debes escribir una consulta antes de buscar.', true);
    return;
  }

  setStatus('Buscando en la web...');
  clearResults();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'No fue posible completar la busqueda.');
    }

    renderResults(payload.results || []);
  } catch (error) {
    setStatus(error.message || 'Ha ocurrido un error inesperado.', true);
  }
}

form.addEventListener('submit', (event) => {
  event.preventDefault();
  const query = input.value.trim();

  performSearch(query);
});

recentSearchesToggle.addEventListener('click', async () => {
  const isHidden = recentSearchesPanel.hidden;
  recentSearchesPanel.hidden = !isHidden;

  if (isHidden) {
    await loadRecentSearches();
  }
});