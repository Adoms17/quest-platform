function storageKey(scope) {
  return `quest-platform:secret-links:${scope}`
}

export function loadLocalSecretLinks(scope) {
  try {
    const parsed = JSON.parse(localStorage.getItem(storageKey(scope)) || '{}')
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

export function saveLocalSecretLink(scope, id, link) {
  const links = loadLocalSecretLinks(scope)
  links[id] = link
  localStorage.setItem(storageKey(scope), JSON.stringify(links))
  return links
}

export function removeLocalSecretLink(scope, id) {
  const links = loadLocalSecretLinks(scope)
  delete links[id]
  localStorage.setItem(storageKey(scope), JSON.stringify(links))
  return links
}
