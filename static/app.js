const form = document.querySelector('#search-form');
const input = document.querySelector('#search-input');
const resultsContainer = document.querySelector('#results');
const statusNode = document.querySelector('#status');
const template = document.querySelector('#result-template');
const recentSearchesToggle = document.querySelector('#recent-searches-toggle');
const recentSearchesPanel = document.querySelector('#recent-searches');
const recentSearchesList = document.querySelector('#recent-searches-list');
const recentSearchTemplate = document.querySelector('#recent-search-template');
const clearHistoryButton = document.querySelector('#clear-history-button');

function setStatus(message, isError = false) {
  statusNode.textContent = message;
  statusNode.dataset.error = String(isError);
}

function clearResults() {
  resultsContainer.innerHTML = '';
}

function formatDate(value) {
  if (!value) {
    return 'Date not available';
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return 'Date not available';
  }

  return new Intl.DateTimeFormat(undefined, {
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
    const openButton = node.querySelector('.recent-search-open');
    const deleteButton = node.querySelector('.recent-search-delete');
    const query = node.querySelector('.recent-search-query');
    const meta = node.querySelector('.recent-search-meta');

    query.textContent = item.query || 'Search without text';
    meta.textContent = `${item.count || 0} results · ${formatDate(item.fetchedAt)}`;
    openButton.addEventListener('click', () => {
      input.value = item.query || '';
      performSearch(item.query || '');
    });
    deleteButton.addEventListener('click', async () => {
      const confirmed = window.confirm(`The search will be deleted "${item.query || 'without text'}" from the history.`);

      if (!confirmed) {
        return;
      }

      await deleteRecentSearch(item.query || '');
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
      throw new Error('Unable to read recent searches.');
    }

    renderRecentSearches(payload.items || []);
  } catch (error) {
    const errorNode = document.createElement('p');
    errorNode.className = 'recent-searches-empty';
    errorNode.textContent = error.message || 'Unable to load recent searches.';
    recentSearchesList.appendChild(errorNode);
  }
}

async function clearRecentSearches() {
  try {
    const response = await fetch('/api/recent-searches/clear', {
      method: 'POST',
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to clear the history.');
    }

    renderRecentSearches([]);
    clearResults();
    setStatus(payload.message || 'History cleared.');
  } catch (error) {
    setStatus(error.message || 'Unable to clear the history.', true);
  }
}

async function deleteRecentSearch(query) {
  if (!query) {
    setStatus('Unable to identify the search to delete.', true);
    return;
  }

  try {
    const response = await fetch(`/api/recent-searches/item?q=${encodeURIComponent(query)}`, {
      method: 'DELETE',
    });
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to delete that search.');
    }

    await loadRecentSearches();
    setStatus(payload.message || 'Search deleted from history.');
  } catch (error) {
    setStatus(error.message || 'Unable to delete that search.', true);
  }
}

function renderResults(results) {
  clearResults();

  if (!results.length) {
    setStatus('No results were found for that query.');
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

    source.textContent = result.source || 'Unknown source';
    title.textContent = result.title || 'No title';
    snippet.textContent = result.snippet || 'No description available.';
    link.href = result.url;
    link.textContent = result.url;

    if (result.image) {
      media.hidden = false;
      image.src = result.image;
      image.alt = `Image related to ${result.title || 'the result'}`;
    }

    fragment.appendChild(node);
  });

  resultsContainer.appendChild(fragment);
  setStatus(` ${results.length} Results were found.`);
}

async function performSearch(query) {
  if (!query) {
    setStatus('You must enter a query before searching.', true);
    return;
  }

  setStatus('Searching the web...');
  clearResults();

  try {
    const response = await fetch(`/api/search?q=${encodeURIComponent(query)}`);
    const payload = await response.json();

    if (!response.ok) {
      throw new Error(payload.error || 'Unable to complete the search.');
    }

    renderResults(payload.results || []);
  } catch (error) {
    setStatus(error.message || 'An unexpected error occurred.', true);
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

clearHistoryButton.addEventListener('click', async () => {
  const confirmed = window.confirm('All saved search history will be deleted.');

  if (!confirmed) {
    return;
  }

  await clearRecentSearches();
});